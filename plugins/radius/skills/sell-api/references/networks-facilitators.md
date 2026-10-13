# Networks and facilitators

## Networks

| `network` | Chain | Asset | Default facilitator |
| --- | --- | --- | --- |
| `'testnet'` / `'radius-testnet'` | Radius testnet, `eip155:72344` | SBC `0x33ad9e4BD16B69B5BFdED37D8B5D9fF9aba014Fb`, 6 decimals | `https://facilitator.testnet.radiustech.xyz` |
| `'mainnet'` / `'radius'` — **the default when `network` is omitted** | Radius, `eip155:723487` | SBC (same address), 6 decimals | `https://facilitator.radiustech.xyz` |
| `'base-sepolia'` | Base Sepolia, `eip155:84532` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals | `https://x402.org/facilitator` |
| `'base'` | Base, `eip155:8453` | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals | **none**: construction throws until you pass `facilitator` |

`radiusEnv()` from `radius-sdk` reads `RADIUS_NETWORK` (default `'mainnet'`), `RADIUS_FACILITATOR_URL`, `RADIUS_FACILITATOR_API_KEY`, `RADIUS_ASSET_ADDRESS` and `RADIUS_PAY_TO` for spreading into `radiusPayments({ ...radiusEnv(), routes })`; mind its mainnet default.

Any other EVM chain: `definePaymentNetwork({ chain, asset: { address, symbol, decimals, name, version }, facilitatorUrl })` (the asset's EIP-712 `name` / `version` must match the token contract, or signatures will not verify).

**Several networks.** `networks` instead of `network`: every route offers one payment option per network, in order, each settled by its own facilitator.

```typescript
radiusPayments({
  networks: ['testnet', { network: 'base-sepolia', facilitator: { url: 'https://x402.org/facilitator' } }],
  payTo: process.env.PAY_TO as `0x${string}`,     // the same address on every EVM chain
  routes: { 'GET /api/report': '$0.001' },        // 0.001 SBC on Radius, 0.001 USDC on Base Sepolia
});
```

- Top-level `facilitator` and overrides (`rpcUrl`, `asset`, `facilitatorUrl`) apply to the **first** network only; give the others theirs in `{ network, facilitator }`.
- A price naming an asset (`{ amount, asset }`) is rejected with several networks; use a USD price or a bare atomic amount.
- A network listed twice throws. Each facilitator only answers for its own network (a multi-chain facilitator configured for Base cannot capture Radius payments).

## Facilitator options

`facilitator` is either `FacilitatorOptions` or a `FacilitatorClient`:

| Option | Effect |
| --- | --- |
| `{ url }` | Another hosted facilitator (trailing slashes are stripped). |
| `{ apiKey }` | Sent as an `x-api-key` header on `/supported`, `/verify` and `/settle`. A static header only: no JWTs, no request signing. |
| `{ live: false }` | Radius networks only: skip the `/supported` request and use the SDK's built-in Radius answer (faster cold start; stale if the facilitator changes). Throws on other networks. |
| `{ timeoutMs }` | Per-call timeout. A timeout or dropped connection becomes a `502` (unknown outcome), not a `402`. |
| a `FacilitatorClient` | Any object with `getSupported()`, `verify(payload, requirements)` and `settle(payload, requirements)` (the interface from `@x402/core/server`): a self-hosted facilitator or one with its own auth. |

`/supported` is read lazily, on the first paid request after each cold start, by `radiusPayments()` and Hono (no module-scope I/O). If it fails the route answers `502` and the next request retries. The upstream adapters (`@x402/express`) read it when constructed.

**Coinbase CDP facilitator: not supported out of the box.** CDP authenticates each request with a JWT, which `{ url, apiKey }` cannot send. It needs a custom `FacilitatorClient` that adds the JWT; the SDK ships none and no test covers one. Tell the user this rather than configuring `{ url, apiKey }` against CDP.

**Third-party facilitators** may list different networks, transfer methods or extensions. Check before relying on one:

```bash
curl -s https://facilitator.testnet.radiustech.xyz/supported | jq '.kinds[] | {network, scheme, method: .extra.assetTransferMethod}'
radius-cli sell check http://127.0.0.1:3000/api/report --facilitator https://facilitator.example
```

`sell check` fails an offer whose scheme, network or transfer method the facilitator does not list, and warns when the 402 declares gas sponsoring the facilitator does not offer.

## Environment variables a seller usually needs

| Variable | Used for |
| --- | --- |
| `PAY_TO` (or `RADIUS_PAY_TO` with `radiusEnv()`) | recipient address |
| `RADIUS_FACILITATOR_URL` / `RADIUS_FACILITATOR_API_KEY` | non-default facilitator |
| `MPP_SECRET_KEY` | `mpp.secretKey`, a secret, the same on every instance |
| `RADIUS_NETWORK` | only if the code reads it; name the network in code otherwise |

Sellers never need a private key: the facilitator submits the settlement transaction.
