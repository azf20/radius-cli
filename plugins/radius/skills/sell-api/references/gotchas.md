# Seller gotchas: current SDK behavior and mitigations

These are behaviors of `radius-sdk` 0.5 and the upstream x402 adapters as the repository's seller evaluation (`pnpm eval:payments:sell`) records them: graded checks marked XFAIL (a known gap) or behaviors recorded under `observations`. Items that were run by hand and are not in the eval say so. Treat them as how the code works today, and apply the mitigation in the integration. If a later SDK release fixes one, the eval's XFAIL marker is removed.

## 1. An unpaid `HEAD` runs the paid `GET` handler (all wrappers)

x402 route keys match the HTTP method exactly, and routers (Hono, Express, most route-handler frameworks) answer `HEAD` with the `GET` handler. So `HEAD /api/report` is not a paid route: the handler runs unpaid. No body is delivered, but the handler's work, side effects and response headers are.

**Mitigate:** price `HEAD` too, next to each paid `GET`:

```typescript
routes: { 'GET /api/report': '$0.001', 'HEAD /api/report': '$0.001' }
```

An unpaid `HEAD` then gets a `402` and the handler does not run. The same holds in Next.js middleware, Astro middleware and a Worker in front of an origin: the seller eval confirms an unpaid HEAD gets a 402 once the HEAD route is priced. Alternatively refuse `HEAD` on paid paths before the router reaches the handler. A route key without a method (`'/api/report'`) charges every method, including CORS preflight `OPTIONS`, so avoid that unless the route is not called from browsers. `radius-cli sell check URL --probe-head` warns when an unpaid `HEAD` is served.

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

## 10. Upstream adapters: x402 only, `/supported` at construction, Next 16.2.6

`@x402/express` / `@x402/next` serve no MPP challenge even when `mpp` is configured, and fetch the facilitator's `/supported` when constructed (their `syncFacilitatorOnStart`), which a runtime forbidding module-scope I/O rejects. `@x402/next` also needs `next >= 16.2.6` (its peer dependency), so Next 15 projects are outside its supported range.

**Mitigate:** use `radiusPayments()` or Hono for MPP and on Workers; on Node the upstream behavior is fine. On Next.js use `radiusPayments()` in `middleware.ts` / `proxy.ts` ([frameworks.md](frameworks.md)).

## 11. No seller-side replay cache

Replays are refused by the facilitator and the chain (the authorization nonce), not by the seller. In `'after'` mode a concurrent replay runs the handler twice (one delivery). Key exactly-once side effects by `receipt.transaction`. See [settlement.md](settlement.md).

## 12. Astro: prerendered pages are not gated, and an unguarded middleware writes the 402 into them

A page with `prerender = true` is built once and served as a static file, so the request-time middleware never gates it: an unpaid request gets the page (`200`, `Cache-Control: public, max-age=0`). Worse, the build renders prerendered pages through the middleware: without a guard, `pay` answers that build-time request with its `402` and the built `dist/client/<page>/index.html` contains `{}` (or `{"error":"facilitator_error",...}` when the facilitator is unreachable). The build still exits 0, and readers get a broken page. Observed on Astro 4.15.12 and 5.18.1 with the Node adapter (`SELL-ASTRO-MW`).

**Mitigate:** `export const prerender = false` on every gated route, and guard the middleware: `if (context.isPrerendered) return next();` on Astro 5, `if (!context.request.headers.get('host')) return next();` on Astro 4 (no `isPrerendered` there). Open the built HTML after the first build. Other adapters (Netlify `edgeMiddleware`, Cloudflare) were not tested.

## 13. Paid 404s: middleware settles before the page renders

Next.js and Astro middleware charge, then let the framework render. A request for a page that does not exist is paid for and answered `404`. In Next middleware `NextResponse.next()` is always a `200` to the SDK, so `settle: 'after'` does not avoid the charge (eval, `SELL-NEXT-MW`). In a Worker in front of an origin the origin's status is visible, so `settle: 'after'` does skip the charge on a `404` and still charges a `200` (`SELL-WORKER-PROXY`).

**Mitigate:** charge only pages you know exist (check the slug before `pay`; an unknown slug then gets a free `404` with no challenge, eval-verified on Next), or use `settle: 'after'` behind a proxy. See [publishers.md](publishers.md).

## 14. `resource.url` says `localhost` behind a proxy

Self-hosted `next start` builds `req.url` from its own hostname and ignores `Host` and `X-Forwarded-Host` (it applies only `X-Forwarded-Proto`), so `pay(req, ...)` in middleware reports `https://localhost:<port>/...`. Astro 5 ignores both headers unless `security.allowedDomains` names the host (`http://localhost/...`). Payments still settle, but `radius-cli sell check` fails the `resource` check on the deployed URL. Astro 4.15 honoured `X-Forwarded-Host` and `X-Forwarded-Proto` unchanged.

**Mitigate:** on Next, rebuild the request from `x-forwarded-host` (or `host`) and `x-forwarded-proto` before `pay` (`publicRequest` in [frameworks.md](frameworks.md); the eval verifies it). On Astro 5, set `security.allowedDomains`. Confirm with `radius-cli sell check` against the public URL. Vercel production `request.url` was not tested.

## 15. CDN headers on the origin response pass through to the payer

On a paid response the SDK appends `private` to `Cache-Control` and leaves every other origin header alone, including `Surrogate-Control`, `CDN-Cache-Control`, `Surrogate-Key` and `Set-Cookie` (`SELL-WORKER-PROXY`: `public, s-maxage=600` became `public, s-maxage=600, private`, and the other three arrived unchanged). Fastly and Cloudflare document those headers as taking precedence over `Cache-Control`, which would let a CDN store a paid page (the CDN behavior itself was not tested). Separately, a CDN that caches the free human HTML can serve it to agents with no gate.

**Mitigate:** gate before the cache, and strip the CDN headers from paid responses in the Worker (the wrapper in [publishers.md](publishers.md) is eval-verified).

## 16. Fastly Compute: `AbortSignal is not defined`

`@x402/core` calls `AbortSignal.timeout()`; Fastly Compute's runtime (`@fastly/js-compute` 4.0 on Viceroy) had no `AbortSignal`, so a paid route answered `502 facilitator_error: ... AbortSignal is not defined`. A five-line shim fixed it locally ([frameworks.md](frameworks.md)). Run by hand only, not by the eval; no production Fastly service was tried. Fastly VCL-only services cannot run the SDK.

## 17. A Node proxy in front of an origin: stream bodies and the origin's headers

Forwarding the incoming body stream, `fetch(upstream, { method, headers, body: req.body })`, throws `TypeError: RequestInit: duplex option is required when sending a body.` on Node 20, 22 and 24 alike (undici; checked on 20.20, 22.22 and 24.22), so every `POST` through the proxy answers 500; forwarding `Keep-Alive`, `Expect: 100-continue` or other hop-by-hop headers throws too. Separately, under `@hono/node-server` a paid route that returns the `fetch()` response as-is fails **after** settlement: the server's `Response` keeps the origin's immutable headers, adding the receipt throws `TypeError: immutable`, and the payer is charged for a 500. Run by hand (x402, `settle: 'before'`, mock facilitator), not by the eval.

**Mitigate:** buffer the body (`await req.arrayBuffer()`, or pass the stream with `duplex: 'half'`), drop hop-by-hop headers, `Expect`, `Content-Length` and `Host`, and return `new Response(res.body, { status: res.status, headers: new Headers(res.headers) })`. The Hono proxy in [frameworks.md](frameworks.md) does all three.
