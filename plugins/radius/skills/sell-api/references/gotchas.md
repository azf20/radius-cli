# Seller gotchas: current SDK behavior and mitigations

These are behaviors of `radius-sdk` 0.5 and the upstream x402 adapters as the repository's seller evaluation (`pnpm eval:payments:sell`) records them: graded checks marked XFAIL (a known gap) or behaviors recorded under `observations`. Treat them as how the code works today, and apply the mitigation in the integration. If a later SDK release fixes one, the eval's XFAIL marker is removed.

## 1. An unpaid `HEAD` runs the paid `GET` handler (all wrappers)

x402 route keys match the HTTP method exactly, and routers (Hono, Express, most route-handler frameworks) answer `HEAD` with the `GET` handler. So `HEAD /api/report` is not a paid route: the handler runs unpaid. No body is delivered, but the handler's work, side effects and response headers are.

**Mitigate:** price `HEAD` too, next to each paid `GET`:

```typescript
routes: { 'GET /api/report': '$0.001', 'HEAD /api/report': '$0.001' }
```

An unpaid `HEAD` then gets a `402` and the handler does not run. Alternatively refuse `HEAD` on paid paths before the router reaches the handler. A route key without a method (`'/api/report'`) charges every method, including CORS preflight `OPTIONS`, so avoid that unless the route is not called from browsers. `radius-cli sell check URL --probe-head` warns when an unpaid `HEAD` is served.

## 2. A handler registered before the payment middleware is served free

Express and Hono run handlers in registration order. A paid route defined before `app.use(paymentMiddleware(...))` / `app.use(radiusPayments(...))` answers first, and the middleware never runs.

**Mitigate:** register the payment middleware first; only free routes (health checks) may come before it. `sell check` fails with "the route is served without payment".

## 3. On Hono, a handler's `Cache-Control` replaces the SDK's `private`

`radius-sdk/hono` assigns `c.res`, and Hono's `c.res` setter copies the handler response's headers back over the SDK's response. A paid handler that sets `Cache-Control: public, max-age=60` ships exactly that, so a shared cache can serve the paid response to the next, unpaying, caller. On the other wrappers the SDK adds `private`, but keeps a handler's `public` next to it.

**Mitigate:** do not mark paid responses `public`. If a paid handler sets `Cache-Control`, include `private` yourself (`private, max-age=60`), or set none.

## 4. `settle: 'after'`: a failed settlement withholds the body but not the headers (Hono, Express)

In `'after'` mode the handler runs before settlement. If settlement is then rejected or its outcome is unknown, the body is withheld, but headers the handler set still reach the unpaying client on `radius-sdk/hono` (the same `c.res` merge) and on `@x402/express` (it drops the buffered body, keeps headers already set). The web-standard `radiusPayments()` withholds both.

**Mitigate:** keep the default `settle: 'before'`. If you need `'after'`, never put protected data in response headers.

## 5. Overlapping routes: the first declared key wins

x402 core matches route keys in declaration order. With `'GET /api/*'` declared before `'GET /api/premium/*'`, premium paths are priced at the generic price.

**Mitigate:** declare specific routes before wildcards. Check each price with `sell check URL --price ...`.

## 6. A payment for one URL can unlock another URL with the same offer

The challenge's `resource.url` names the requested URL, but sellers match a payment against the **offer** (scheme, network, asset, amount, recipient), not the URL. A payment quoted for `/api/x` is accepted on `/api/y` when both resolve to the same offer, for example two paths under one wildcard route. Each authorization still settles only once.

**Mitigate:** make every unit of value its own priced route, or bind the offer to the resource with a dynamic `price` or `payTo` (the eval confirms a payment to one creator's `payTo` cannot unlock another's, and a basic-tier price cannot unlock a gold-tier one). Do not rely on `resource.url` alone to separate resources of equal price.

## 7. `network` omitted means Radius mainnet

`radiusPayments({})`, `createRadiusServer({})` and `radiusEnv()` without `RADIUS_NETWORK` all resolve to Radius **mainnet**. A testnet integration that forgets `network: 'testnet'` charges real SBC.

**Mitigate:** always name the network. `sell check` prints it for every offer.

## 8. `settle: 'before'` charges for errors

A paid route whose handler then answers 404, 500 or throws has already settled (the response carries the receipt). See [settlement.md](settlement.md).

**Mitigate:** validate before charging; record failures with the receipt.

## 9. Decimals and amounts

USD prices are converted with the asset's decimals: SBC and USDC have 6, so `'$0.001'` is `'1000'`. An `asset: { decimals: 18 }` override or an 18-decimal atomic amount produces `1000000000000000` for $0.001, a billion-SBC price no buyer will pay.

**Mitigate:** price in USD strings; run `sell check URL --price '$0.001'`, which names the decimals an amount implies.

## 10. Upstream adapters: x402 only, `/supported` at construction

`@x402/express` / `@x402/next` serve no MPP challenge even when `mpp` is configured, and fetch the facilitator's `/supported` when constructed (their `syncFacilitatorOnStart`), which a runtime forbidding module-scope I/O rejects.

**Mitigate:** use `radiusPayments()` or Hono for MPP and on Workers; on Node the upstream behavior is fine.

## 11. No seller-side replay cache

Replays are refused by the facilitator and the chain (the authorization nonce), not by the seller. In `'after'` mode a concurrent replay runs the handler twice (one delivery). Key exactly-once side effects by `receipt.transaction`. See [settlement.md](settlement.md).
