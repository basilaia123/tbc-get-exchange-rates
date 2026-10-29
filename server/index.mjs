#!/usr/bin/env node
// Zero-dependency stdio MCP server for TBC Bank exchange rates.
// Docs: https://developers.tbcbank.ge/docs/exchangerates-overview
//
// Domain types (what every tool returns):
//   FxRate        = { currency: "USD", buy: number|null, sell: number|null, official: number|null }
//                   GEL per 1 unit of `currency`. buy/sell = TBC commercial, official = NBG.
//   RatesSnapshot = { base: "GEL", date: "YYYY-MM-DD"|null, retrievedAt: ISO, rates: FxRate[] }
//   Conversion    = { from, to, amount, value, source: "commercial"|"nbg", retrievedAt: ISO }
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SERVER = { name: "tbc-fx", version: "0.1.0" };
const ALLOWED_BASES = ["https://api.tbcbank.ge", "https://test-api.tbcbank.ge"];
const KEY_HELP =
  "Get a free key: sign up at https://developers.tbcbank.ge, create an app with the Exchange Rates product, " +
  "copy its API key (https://developers.tbcbank.ge/docs/get-apikey-and-secret), then set TBC_API_KEY in the " +
  "MCP server environment or write {\"apiKey\":\"...\"} to $PLUGIN_DATA/tbc.json.";

class ToolError extends Error {}

const unexpanded = (v) => typeof v === "string" && /^\$\{.*\}$/.test(v.trim());
const clean = (v) => (typeof v === "string" && v.trim() && !unexpanded(v) ? v.trim() : null);

function fileConfig() {
  const dir = clean(process.env.PLUGIN_DATA);
  if (!dir) return {};
  try { return JSON.parse(readFileSync(join(dir, "tbc.json"), "utf8")); } catch { return {}; }
}

function config() {
  const file = fileConfig();
  const apiKey = clean(process.env.TBC_API_KEY) ?? clean(file.apiKey);
  const base = (clean(process.env.TBC_API_BASE) ?? clean(file.apiBase) ?? ALLOWED_BASES[0]).replace(/\/+$/, "");
  if (!ALLOWED_BASES.includes(base)) throw new ToolError(`TBC_API_BASE must be one of ${ALLOWED_BASES.join(", ")}`);
  if (!apiKey) throw new ToolError(`No TBC API key configured. ${KEY_HELP}`);
  return { apiKey, base };
}

async function tbc(path, query) {
  const { apiKey, base } = config();
  const url = new URL(`${base}/v1/exchange-rates/${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, { headers: { apikey: apiKey, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new ToolError(`Could not reach TBC API (${url.host}): ${e.message}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (res.status === 401) throw new ToolError(`TBC API rejected the API key (401 Invalid Api Key). ${KEY_HELP}`);
  if (!res.ok) {
    const detail = body?.detail || body?.title || text.slice(0, 200);
    throw new ToolError(`TBC API error ${res.status}: ${detail}${body?.systemCode ? ` (${body.systemCode})` : ""}`);
  }
  if (body === null) throw new ToolError("TBC API returned a non-JSON response.");
  return body;
}

const CODE = /^[A-Z]{3}$/;
function codes(list) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw new ToolError("currencies must be an array of 3-letter codes");
  const out = [...new Set(list.map((c) => String(c).trim().toUpperCase()))];
  for (const c of out) if (!CODE.test(c)) throw new ToolError(`Invalid currency code: ${c}`);
  return out.length ? out : null;
}
function code(v, name) {
  const c = String(v ?? "").trim().toUpperCase();
  if (!CODE.test(c)) throw new ToolError(`${name} must be a 3-letter currency code`);
  return c;
}

async function getRates(args) {
  const source = args.source ?? "both";
  if (!["commercial", "nbg", "both"].includes(source)) throw new ToolError("source must be commercial, nbg, or both");
  const date = args.date ?? null;
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError("date must be YYYY-MM-DD");
    if (source !== "nbg") throw new ToolError("date is only supported for official NBG rates; set source to \"nbg\"");
  }
  const list = codes(args.currencies);
  const currency = list?.join(",");
  const byCode = new Map();
  const row = (c) => byCode.get(c) ?? byCode.set(c, { currency: c, buy: null, sell: null, official: null }).get(c);

  const [commercial, nbg] = await Promise.all([
    source === "nbg" ? null : tbc("commercial", { currency }),
    source === "commercial" ? null : tbc("nbg", { currency, date }),
  ]);
  for (const r of commercial?.commercialRatesList ?? []) Object.assign(row(r.currency), { buy: r.buy, sell: r.sell });
  for (const r of Array.isArray(nbg) ? nbg : []) row(r.currency).official = r.value;

  const rates = [...byCode.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const snapshot = { base: commercial?.base ?? "GEL", date, retrievedAt: new Date().toISOString(), rates };
  if (list) {
    const missing = list.filter((c) => c !== "GEL" && !byCode.has(c));
    if (missing.length) snapshot.notFound = missing;
  }
  return snapshot;
}

async function convert(args) {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ToolError("amount must be a positive number");
  const from = code(args.from, "from");
  const to = code(args.to, "to");
  const source = args.source ?? "commercial";
  if (!["commercial", "nbg"].includes(source)) throw new ToolError("source must be commercial or nbg");
  const r = await tbc(`${source === "nbg" ? "nbg" : "commercial"}/convert`, { amount, from, to });
  if (typeof r?.value !== "number") throw new ToolError(`TBC API returned no conversion value for ${from}->${to}`);
  return { from: r.from ?? from, to: r.to ?? to, amount: r.amount ?? amount, value: r.value, source, retrievedAt: new Date().toISOString() };
}

const currencyList = { type: "array", items: { type: "string", pattern: "^[A-Za-z]{3}$" }, description: "3-letter ISO codes, e.g. [\"USD\",\"EUR\"]. Omit for all available." };
const TOOLS = [
  {
    name: "get_rates",
    description: "Live GEL exchange rates from TBC Bank. Returns per-currency TBC commercial buy/sell and official NBG rate (GEL per 1 unit). Use date (NBG only) for a historical official rate.",
    inputSchema: {
      type: "object",
      properties: {
        currencies: currencyList,
        source: { type: "string", enum: ["commercial", "nbg", "both"], default: "both", description: "commercial = TBC buy/sell, nbg = National Bank of Georgia official rate." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD; only with source=nbg." },
      },
      additionalProperties: false,
    },
    run: getRates,
  },
  {
    name: "convert",
    description: "Convert an amount between two currencies (either can be GEL) using TBC Bank's commercial rates or the official NBG rate, computed by TBC's API.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", exclusiveMinimum: 0 },
        from: { type: "string", pattern: "^[A-Za-z]{3}$" },
        to: { type: "string", pattern: "^[A-Za-z]{3}$" },
        source: { type: "string", enum: ["commercial", "nbg"], default: "commercial" },
      },
      required: ["amount", "from", "to"],
      additionalProperties: false,
    },
    run: convert,
  },
];

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ run, ...t }) => t) };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
      try {
        const data = await tool.run(params.arguments ?? {});
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (msg.id === undefined || msg.id === null) return; // notification
  try {
    send({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
