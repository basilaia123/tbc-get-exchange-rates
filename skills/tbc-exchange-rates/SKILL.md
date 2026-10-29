---
name: tbc-exchange-rates
description: Use when the user asks for Georgian lari (GEL) exchange rates, TBC Bank buy/sell rates, the official National Bank of Georgia (NBG) rate, or to convert money to or from GEL at TBC or NBG rates.
---

# TBC Bank exchange rates

Use the `tbc-fx` MCP tools. Never quote a rate from memory; every number must come from a tool call made in this turn.

- `get_rates` - GEL per 1 unit of each currency. `buy`/`sell` are TBC commercial rates (bank buys / sells the foreign currency); `official` is the NBG rate. Pass `currencies` to narrow, `source: "nbg"` with `date: "YYYY-MM-DD"` for a historical official rate. Commercial rates are current only.
- `convert` - amount from one currency to another, computed by TBC (`source: "commercial"` default, or `"nbg"`).

When answering, say which rate type you used (TBC commercial vs NBG official) and include `retrievedAt` (or `date` for historical NBG). If a currency comes back in `notFound`, say TBC does not quote it; do not estimate.

If a tool returns an API key error, tell the user how to get a key (developers.tbcbank.ge -> create app with Exchange Rates product -> copy API key) and to set `TBC_API_KEY`. Do not guess numbers instead.
