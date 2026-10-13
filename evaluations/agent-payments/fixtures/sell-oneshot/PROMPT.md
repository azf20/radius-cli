# Task: sell an API endpoint with radius-sdk ({{FRAMEWORK}})

You are in an empty TypeScript project (the current directory). Write `server.ts`: a {{FRAMEWORK}} app that charges for one endpoint with x402 payments on Radius testnet, using `radius-sdk`.

Requirements:

- `GET /health` is free and answers HTTP 200 with JSON.
- `GET /api/report` costs **$0.001 per request** on **Radius testnet**, paid to the address in the `PAY_TO` environment variable. Once paid, it answers JSON containing `"report": "quarterly-sales"`.
- Verify and settle payments through the facilitator whose base URL is in `RADIUS_FACILITATOR_URL`.
- Listen on `127.0.0.1` at the port in `PORT`.
- Do not hardcode addresses, keys or URLs.

Constraints:

- The grader starts the app with `node --experimental-strip-types server.ts` (Node 22+). Use only erasable TypeScript: no enums, namespaces or parameter properties, and `import type` for type-only imports.
- You cannot install packages. Use only what `package.json` lists; they are already in `node_modules`.

References: `{{REPO_ROOT}}/packages/sdk/README.md` (the SDK) and `{{REPO_ROOT}}/plugins/radius/skills/x402/SKILL.md` (the x402 skill).
