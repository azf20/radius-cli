# Radius SDK — PoC plan

Status: draft for discussion, 2026-09-11. Nothing here is shipped.

## Goal

Make "accept Radius payments" and "make Radius payments" each a handful of lines,
without inventing a new protocol. Sellers add one Hono middleware; buyers (humans
or agents) wrap `fetch`. Everything on the wire stays standard x402 v2, so any
x402-capable agent can pay a Radius-SDK endpoint with no Radius-specific knowledge.

## Context (what already exists)

- dev-docs is being repositioned around two journeys: **Accept payments** and
  **Make payments** (uncommitted local work in `~/dev-docs`, plus
  `planning/docs-refresh.md`). Style guide now says: keep proposed SDK features in
  planning docs until working examples validate them. This repo is that example.
- `~/radius-priorities/proposal.md` sketches the SDK: small shared core, two entry
  points (server middleware + paid fetch), integer base units, per-request ceiling
  is not a budget, x402 first, MPP as a later spike.
- radius-cli v0.1.5 (`~/radius-cli`, now synced to upstream incl. PR #19) has a
  working hand-rolled x402 v2 client: exact + upto, Permit2, EIP-3009. It is the
  "agent with general x402 knowledge" we test against.
- Radius facilitators (live, checked 2026-09-11):
  - testnet `https://facilitator.testnet.radiustech.xyz` → `eip155:72344`
  - mainnet `https://facilitator.radiustech.xyz` → `eip155:723487`
  - both: `exact` / `assetTransferMethod: permit2` / SBC `0x33ad…14Fb` (6 dp,
    permit domain "Stable Coin" v1) / extension `eip2612GasSponsoring`.
- Official x402 v2 packages (`@x402/core|evm|hono|fetch` 2.25.0):
  - `@x402/evm` default-asset table already includes Radius mainnet and testnet
    SBC with `assetTransferMethod: "permit2"` and `supportsEip2612: true`.
  - `ExactEvmScheme` (client) does Permit2 signing and, when the 402 declares
    `eip2612GasSponsoring`, signs the EIP-2612 permit so no on-chain approval tx
    is ever needed. That is exactly the Radius flow.
  - `@x402/hono` `paymentMiddleware(routes, resourceServer)` with `price: "$0.01"`.
  - No `node:` imports in core/evm/hono/fetch → Workers-compatible in principle.
  - Caveat: `paymentMiddleware` calls `resourceServer.initialize()` (a fetch to
    `/supported`) at middleware-construction time. Cloudflare Workers forbid I/O
    at module scope, so the SDK must own initialization (see design).
  - Caveat: `x402Client` spend controls default to "$X per payment, default assets
    only". Radius SBC is a default asset, so it passes, but the SDK should set the
    cap explicitly rather than inherit the upstream default.

## Decision: wrap `@x402/*`, don't hand-roll

Recommended. Reasons: protocol code stays upstream-maintained; the Radius flow is
already implemented there; the wire format is guaranteed standard, so stock x402
clients (and agents) interoperate. The SDK's job is defaults, ergonomics, Workers
fit, receipts, and guardrails.

Risks to retire in the PoC:
1. Bundle size on Workers (viem + @x402/evm). Measure with wrangler; target < 1 MB
   gzipped. If too big, server side can avoid `@x402/evm` entirely (it only needs
   money parsing + the static `extra`), since the facilitator does all crypto.
2. Module-scope init (above). Solved by a Radius facilitator client with a static
   `/supported` answer plus lazy live refresh.
3. Confirm `@x402/hono` + `@x402/extensions` dynamic import doesn't bloat or break
   the Workers bundle (bazaar is only imported when routes ask for it).

## Package shape (working name `radius-sdk`, to be decided)

One package, ESM, subpath exports so servers never pull the signing code:

| Import                     | For                    | Pulls in                  |
| -------------------------- | ---------------------- | ------------------------- |
| `radius-sdk`               | networks, amounts, receipts | nothing heavy        |
| `radius-sdk/hono`          | seller middleware      | @x402/core, @x402/hono, hono (peer) |
| `radius-sdk/client`        | paid fetch for buyers/agents | @x402/core, @x402/evm, @x402/fetch, viem |
| `radius-sdk/node` (later)  | radius-cli keystore loader, env helpers | node only |

## Proposed interfaces

### Networks and defaults

```ts
import { radiusTestnet, radiusMainnet, radiusTestnetChain, radiusMainnetChain, defineRadiusNetwork, resolveNetwork } from 'radius-sdk';

interface RadiusNetwork {
  name: 'testnet' | 'mainnet' | string;
  chain: Chain;                  // viem Chain: the source of truth (radiusMainnetChain / radiusTestnetChain)
  chainId: number;               // derived: chain.id (72344 | 723487)
  network: `eip155:${number}`;   // derived: CAIP-2, what x402 uses
  rpcUrl: string;                // derived: chain.rpcUrls.default.http[0]
  facilitatorUrl: string;
  explorerUrl?: string;          // derived: chain.blockExplorers.default.url
  asset: { address: `0x${string}`; symbol: 'SBC'; decimals: 6; name: 'Stable Coin'; version: '1' };
  testnet: boolean;              // derived: chain.testnet ?? false
}

// 'testnet' | 'mainnet' | RadiusNetwork | partial override
resolveNetwork('testnet');
resolveNetwork('testnet', { rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY' });  // chain carries the override too
defineRadiusNetwork({ chainId: 9999, rpcUrl, facilitatorUrl, asset: {...} }); // custom instance
defineRadiusNetwork({ chain: myViemChain, facilitatorUrl });                   // or from a viem Chain
```

Default currency is SBC everywhere. Prices are USD strings (`"$0.01"` or `"0.01"`)
because SBC is USD-pegged, or `{ amount: "10000" }` atomic units. Never floats.

### Seller: Hono middleware (Cloudflare Workers first)

```ts
import { Hono } from 'hono';
import { radiusPayments } from 'radius-sdk/hono';

type Env = { PAY_TO: string };
const app = new Hono<{ Bindings: Env }>();

app.use(radiusPayments({
  network: 'testnet',                        // 'mainnet' | RadiusNetwork | custom
  payTo: (c) => c.env.PAY_TO,                // or a literal address
  routes: {
    'GET /api/lookup':  { price: '$0.001', description: 'Threat-intel lookup' },
    'POST /api/query':  { price: '$0.01' },
    'GET /api/report/*': { price: { amount: '100000' } },   // atomic SBC
  },
  // optional:
  facilitator: { url?: string; apiKey?: string; live?: boolean },
  onSettled?: (receipt, c) => void,          // log / persist payment ids
}));

app.get('/api/lookup', (c) => c.json({ ... }));   // runs only after settlement
```

Behaviour:
- Returns a spec-compliant 402 with `PAYMENT-REQUIRED` (base64 JSON), `accepts[]`
  = one `exact`/permit2/SBC entry, and `extensions.eip2612GasSponsoring` declared.
- Verifies then settles through the Radius facilitator; serves the handler only
  after successful settlement (upstream "authorization" flow); attaches
  `PAYMENT-RESPONSE`.
- Facilitator `/supported` is known statically per network; `live: true` refreshes
  lazily on first request. No I/O at module scope.
- `c.get('radiusPayment')` exposes `{ payer, amount, transaction, network }` to the
  handler.

Later: a plain `fetch`-handler variant for non-Hono Workers, and Express/Next.

### Buyer / agent: paid fetch

```ts
import { createRadiusFetch } from 'radius-sdk/client';
import { privateKeyToAccount } from 'viem/accounts';

const payFetch = createRadiusFetch({
  network: 'testnet',
  signer: privateKeyToAccount(process.env.RADIUS_PRIVATE_KEY),  // viem account, or any { address, signTypedData }
  maxPerRequest: '$0.05',            // hard per-request ceiling; required? default?
  // optional:
  onPaymentRequired?: (offer) => boolean | Promise<boolean>,  // agent hook: approve/decline
  onPaid?: (receipt) => void,
});

const res = await payFetch('https://api.example.com/api/lookup?q=1.2.3.4');
const receipt = getPaymentReceipt(res);   // decoded PAYMENT-RESPONSE, or undefined
```

Behaviour:
- Wraps `@x402/fetch` + `ExactEvmScheme` registered for the configured chain only,
  with an RPC-backed signer so gas sponsoring works (needs `readContract`).
- Per-request ceiling is enforced before signing; it is NOT a cumulative budget
  (documented loudly, per the proposal).
- Single-network by design: offers on any other network are refused with
  `network_mismatch` before signing. (An earlier sketch had `allowedNetworks`; dropped.)
- Wallet helpers on the same object: `payFetch.address`, `payFetch.balance()`
  (SBC), and on testnet `payFetch.fund()` (faucet drip) if the faucet API allows.

### Receipts and errors

```ts
type PaymentReceipt = { success: boolean; transaction?: `0x${string}`; network: string; payer: string; amount: string; explorerUrl?: string };
class RadiusPaymentError extends Error { code: 'price_above_limit' | 'network_mismatch' | 'no_compatible_offer' | 'settle_failed' | 'facilitator_unreachable' | ... }
```

## Repo layout

```
radius-sdk/
  PLAN.md  README.md  package.json  tsconfig.json
  src/
    index.ts        networks.ts  amounts.ts  receipt.ts  errors.ts
    hono/index.ts   facilitator.ts (static-supported FacilitatorClient)
    client/index.ts
  examples/
    worker-seller/   (Hono on Workers: free /health, paid /api/lookup, wrangler.toml)
    agent-buyer/     (Node script: createRadiusFetch → buys lookup, prints receipt)
  test/             (vitest: 402 shape, price parsing, spend cap; e2e gated by env)
```

## Milestones

1. **Scaffold + seller path.** networks, Hono middleware, worker example running under
   `wrangler dev`. Prove the 402 is standard: pay it with stock `radius-cli wallet x402`
   on testnet (the agent-compat test) and with `@x402/fetch` unwrapped.
2. **Buyer path.** `createRadiusFetch`; SDK client pays SDK server on testnet, real
   settlement, receipt decoded. Negative tests: over-cap offer refused, mainnet offer
   refused on a testnet client, invalid signature withheld.
3. **Workers hardening.** bundle size, cold start, no module-scope I/O, `c.env`-driven
   config, deploy the example worker for real.
4. **Docs.** README quickstarts mirroring the dev-docs journeys; feed findings back
   into `dev-docs/planning`.
5. Later / not in PoC: `upto` scheme, session budgets, radius-cli keystore loader,
   Express/Next adapters, MPP spike.

## Open questions

- Package name and scope (`@radiustech/sdk`? `radius-sdk`? split `-hono`/`-client`?).
- Client default network: testnet (safe) vs mainnet (radius-cli defaults mainnet).
- `maxPerRequest`: required, or default to something like `$0.10`?
- Should the server default to the "authorization" flow (settle before handler) or
  offer "settle after handler" for handlers that may fail?
- Do we want the middleware usable without Hono (raw Workers `fetch` handler) in v0?

## Status — 2026-09-11 (end of day one)

Decisions taken: package `radius-sdk` with `/hono` and `/client` subpaths; wrap `@x402/*`
(server side uses `@x402/core` only, no `@x402/evm`/viem); mainnet default; `maxPerRequest`
required; settle before handler (`upfront` flow, `paymentFlow` marked as a server-only extra
via `dynamicExtraFields` so minimal clients that don't echo it still match); currency
overridable per network/asset.

Done and verified on testnet:
- Seller: `radiusPayments()` Hono middleware, own adapter + lazy init (no module-scope I/O).
  Facilitator `/supported` is fetched live on the first paid request per cold start (Adam's call:
  static-by-default was too risky while the facilitator is changing; `live: false` opts into the
  built-in answer). `facilitator` accepts `{ url, apiKey }` or a custom `FacilitatorClient`. `wrangler dev` worker bundle
  324 KiB / 65 KiB gzip.
- Agent-compat: stock `radius-cli wallet x402` 0.1.5 paid the worker end-to-end
  (tx `0xb59f…3acc`). It needed a Permit2 approval tx (CLI has no gas-sponsoring support).
- Buyer: `createRadiusFetch()` paid the worker; typed errors for network/asset/price/declined/
  rejected; receipt decoding with explorer link.
- Gasless: fresh wallet holding only 0.005 SBC (allowance 0, no RUSD) paid 0.001 SBC with zero
  gas via `eip2612GasSponsoring`; allowance stays 0 afterwards (exact-amount permit consumed).
- Tests: 14 unit (facilitator mocked) + 5 e2e in-process against the real facilitator, run on both
  testnet and mainnet (`RADIUS_NETWORK=mainnet`; no facilitator API key was needed). Real settlement
  ~3 s testnet / ~4 s mainnet; forged signature withheld; over-cap and wrong-network refused before signing.

Findings to feed back:
- Radius facilitator `/settle` returns no `amount`; that is correct per x402 v2 (optional, meant for
  `upto`-style schemes). For `exact` the SDK fills receipts from the requirement instead.
- Explorer tx URL format `/tx/<hash>` confirmed by Adam (e.g. https://testnet.radiustech.xyz/tx/0x3972e4…3b7c).
- `@x402/hono`'s stock middleware calls `initialize()` at construction; unusable on Workers as-is.
- x402 core prefers `authorization` over `upfront` when both are offered; we offer one.
- The faucet API (`/api/v1/faucet`) sends no CORS headers and answers OPTIONS with 405, so browser
  pages cannot call it directly; the demo proxies it through the worker. Worth fixing server-side
  since the docs pitch the faucet for agent and app onboarding.

Added later on 2026-09-11 (CLI parity pass, Adam's picks; keystore loader deliberately skipped):
- Unsponsored Permit2 path: when the 402 does not declare gas sponsoring, the client sends one
  unlimited approval (`permit2Approval: 'auto' | 'never'`, `onApprovalRequired` veto). Server
  declares `eip2612GasSponsoring` only when the facilitator's `/supported` lists it. Verified on
  testnet and mainnet with a fresh wallet: allowance 0 → MaxUint256 → second payment needs no approval.
  Mainnet faucet drip via `fund()` also verified (0.01 SBC, once per day).
- `send()`, `permit2Allowance()`, `approvePermit2()`, `getSettlement(txHash)` (ERC-20 Transfer logs
  of the payment asset, `paid(to)`), `fund()` (faucet challenge → EIP-191 sign → drip), `radiusEnv()`.
- Unsupported transfer methods (e.g. Stablecoin.xyz `erc2612`) fail with `unsupported_transfer_method`.

- Demo dapp (`examples/demo-dapp`, test-dapp style, local only for now): one worker with four priced
  routes + a page with burner-wallet or MetaMask buyer, faucet, approvals, transfers, unpaid/paid
  fetch, pay-any-URL, reconcile, and an explanatory intro. Client now also accepts a viem
  WalletClient as signer (MetaMask). Page flow verified headlessly (jsdom) on testnet.

Open next:
- Deploy the example worker / demo for real (needs `wrangler login`) and re-run the buyer against it.
- Cumulative budget helper (explicitly out of the SDK core per proposal; maybe a `budget` policy
  object with an injectable store for Workers KV/DO).
- Native RUSD balance/transfer helpers (CLI has them; SDK is SBC-only).
- `upto` scheme once the Radius facilitator advertises it.
- Feed the two quickstarts into `dev-docs/planning` tutorials once the team confirms the shape.
