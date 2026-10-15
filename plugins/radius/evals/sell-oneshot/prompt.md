---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---
I want to charge for one endpoint of my TypeScript API with Radius payments. The current directory is the project. Use the web framework its `package.json` already lists (Hono if it lists none) and write `server.ts`:

- `GET /health` is free and answers HTTP 200 with JSON.
- `GET /api/report` costs **$0.001 per request** on **Radius testnet**, paid to the address in the `PAY_TO` environment variable. Once paid, it answers JSON containing `"report": "quarterly-sales"`.
- Payments verify and settle through the facilitator whose base URL is in `RADIUS_FACILITATOR_URL`.
- It listens on `127.0.0.1` at the port in `PORT`.
- No hardcoded addresses, keys or URLs.

Constraints:

- It is started with `node --experimental-strip-types server.ts` (Node 22+), so use only erasable TypeScript: no enums, namespaces or parameter properties, and `import type` for type-only imports.
- You cannot install packages. Use only what `package.json` lists; they are already in `node_modules`.
- Do not make a payment or create a wallet.

If you cannot write files here, reply with the complete `server.ts` instead. Finish with how I check the unpaid response before I deploy it.
