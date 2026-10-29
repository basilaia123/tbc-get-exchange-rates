# tbc-fx

Agent Plugin wrapping the [TBC Bank Exchange Rates API](https://developers.tbcbank.ge/docs/exchangerates-overview).

Tools: `get_rates(currencies?, source?, date?)`, `convert(amount, from, to, source?)`.

## API key

Every TBC call needs an `apikey` header. Get one free: create a developer account at
https://developers.tbcbank.ge, create an app with the **Exchange Rates** product, and copy the API key
(https://developers.tbcbank.ge/docs/get-apikey-and-secret).

Agent Plugins 1.0.0 has no portable secret fields, so the key is never in `mcp.json`. The server reads, in order:

1. `TBC_API_KEY` from its environment (set it in your client's MCP env / settings), or
2. `{"apiKey": "..."}` in `$PLUGIN_DATA/tbc.json`.

Optional `TBC_API_BASE`: `https://api.tbcbank.ge` (default) or `https://test-api.tbcbank.ge` (sandbox).

## Local check

    TBC_API_KEY=... node scripts/smoke.mjs
