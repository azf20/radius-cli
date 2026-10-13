---
type: llm
---
Judge the `server.ts` the agent wrote or put in its reply, and its closing advice.

PASS if all of these hold:
- It uses the radius-sdk seller for the chosen framework: `radiusPayments` from `radius-sdk/hono` on Hono, `createRadiusServer` from `radius-sdk/server` with `paymentMiddleware` from `@x402/express` on Express, or `radiusPayments` from `radius-sdk/server` on a plain web-standard handler.
- It names Radius testnet explicitly (`network: 'testnet'`), not the SDK's mainnet default.
- The paid route is `GET /api/report` priced `'$0.001'` (or `{ amount: '1000' }`, SBC's 6 decimals), `payTo` comes from `process.env.PAY_TO`, and the facilitator comes from `process.env.RADIUS_FACILITATOR_URL` (`facilitator: { url }` or `facilitatorUrl`).
- `GET /health` is not behind payment, and the paid handler returns `"report": "quarterly-sales"`.
- The closing advice checks the unpaid request for HTTP 402 with a `PAYMENT-REQUIRED` header, preferably with `radius-cli sell check`.

FAIL if it hand-builds x402 headers, signatures or facilitator calls, uses mainnet, prices in 18-decimal units, hardcodes an address, key or URL, releases content before settlement through a custom asynchronous path, asks for a private key, or makes or proposes making a payment. Judge semantics, not exact wording.

This judge reads the transcript only. The deterministic grader for the same prompt boots the written app and pays it against a mock facilitator: `SELL_INTEGRATOR_CMD=... pnpm eval:payments:sell -- --case SELL-ONESHOT` (see `evaluations/agent-payments/README.md` in the repository).
