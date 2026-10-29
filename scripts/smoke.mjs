// Spawns the stdio server and runs initialize, tools/list, and sample tools/call requests.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const child = spawn("node", ["server/index.mjs"], { cwd: root, env: { ...process.env, PLUGIN_ROOT: root }, stdio: ["pipe", "pipe", "inherit"] });
const reqs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_rates", arguments: { currencies: ["USD", "EUR"] } } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "convert", arguments: { amount: 100, from: "USD", to: "GEL" } } },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_rates", arguments: { currencies: ["USD"], source: "nbg", date: "2025-01-15" } } },
];
const pending = new Set(reqs.filter((r) => r.id).map((r) => r.id));
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const r = msg.result;
    const shown = r?.tools ? { tools: r.tools.map((t) => t.name) } : r?.content ? { isError: !!r.isError, text: r.content[0].text } : msg;
    console.log(`#${msg.id}`, JSON.stringify(shown, null, 1));
    pending.delete(msg.id);
    if (!pending.size) child.kill();
  }
});
for (const r of reqs) child.stdin.write(JSON.stringify(r) + "\n");
setTimeout(() => { console.error("timeout"); child.kill(); process.exit(1); }, 30000).unref();
