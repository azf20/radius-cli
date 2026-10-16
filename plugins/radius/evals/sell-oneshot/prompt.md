---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---
I want to charge for one endpoint of my TypeScript API with Radius payments. Produce the complete `server.ts`.

If this workspace contains the project, read its `package.json` and use the web framework it lists (Hono if it lists none). When file writes are available, write `server.ts` there.

If there is no project `package.json`, this is a read-only code example. Use this assumed manifest and return the complete file in your reply; do not refuse because project files or `node_modules` are absent:

```json
{
  "type": "module",
  "dependencies": {
    "radius-sdk": "^0.6.0",
    "hono": "^4.0.0",
    "@hono/node-server": "^2.0.0",
    "viem": "^2.48.11"
  }
}
```

Requirements:

- `GET /health` is free and answers HTTP 200 with JSON.
- `GET /api/report` costs **$0.001 per request** on **Radius testnet**, paid to the address in the `PAY_TO` environment variable. Once paid, it answers JSON containing `"report": "quarterly-sales"`.
- Payments verify and settle through the facilitator whose base URL is in `RADIUS_FACILITATOR_URL`.
- It listens on `127.0.0.1` at the port in `PORT`.
- No hardcoded addresses, keys or URLs.

Constraints:

- It is started with `node --experimental-strip-types server.ts` (Node 22+), so use only erasable TypeScript: no enums, namespaces or parameter properties, and `import type` for type-only imports.
- You cannot install packages. Use only dependencies listed in the actual project manifest, or the assumed manifest for the read-only example, plus Node built-ins.
- Do not make a payment or create a wallet.

If you cannot write files here, reply with the complete `server.ts` instead. Finish with how I check the unpaid response before I deploy it.
