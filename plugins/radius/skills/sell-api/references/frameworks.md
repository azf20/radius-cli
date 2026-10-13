# Framework wrappers

Every wrapper takes the same route table and options; only the glue differs. Pick by what the project already uses. All examples target Radius testnet and read the recipient from `PAY_TO`.

| Wrapper | Package | Tested by this repo | Serves MPP |
| --- | --- | --- | --- |
| `radiusPayments()` web-standard handler | `radius-sdk/server` | unit tests, seller eval (`web`) | yes |
| `radiusPayments()` Hono middleware | `radius-sdk/hono` | unit tests, seller eval (`hono`) | yes |
| `createRadiusServer()` + `@x402/express` | `radius-sdk/server`, `@x402/express` | unit tests, seller eval (`express`) | no |
| `radiusPayments()` in Next.js `middleware.ts` (Next 15, edge runtime) / `proxy.ts` (Next 16) | `radius-sdk/server` | seller eval `SELL-NEXT-MW` (Next 15.5.27, edge). `proxy.ts` and `runtime: 'nodejs'` were run by hand, not by the eval | yes |
| `radiusPayments()` in Astro `src/middleware.ts` (SSR) | `radius-sdk/server` | seller eval `SELL-ASTRO-MW` (Astro 4.15.12 and 5.18.1, Node adapter) | yes |
| `radiusPayments()` in a Cloudflare Worker in front of an origin | `radius-sdk/server` | seller eval `SELL-WORKER-PROXY` (workerd through `wrangler dev`) | yes |
| `radiusPayments()` in Fastly Compute | `radius-sdk/server` | **no**: run by hand on Viceroy, with a shim | yes |
| `createRadiusServer()` + `@x402/next` | `radius-sdk/server`, `@x402/next` | **no** | no |

Publisher sites (articles, pages, a CMS in front) use the middleware and in-front-of-origin rows: see [publishers.md](publishers.md) for who pays and who reads free, CDN caching and paywalls.

Common options (`RadiusServerOptions` in `radius-sdk/server`): `network` or `networks`, `facilitator`, `settle` (`'before'` default, or `'after'`), `mpp`, `gasSponsoring` (`'auto'` default), `onSettled`, and network overrides (`rpcUrl`, `facilitatorUrl`, `asset`). `radiusPayments()` also takes `payTo` and `routes`; `createRadiusServer()` takes those in `radius.routes({ payTo, routes })`.

Route specs (`RouteSpec`): `price` (`'$0.001'`, `'0.001'`, `0.001`, `{ amount: '1000' }`, or a function of the request), `description`, `mimeType`, `maxTimeoutSeconds` (default 300), `payTo` (per-route override). A bare price is shorthand for `{ price }`.

## Hono (`radius-sdk/hono`)

```typescript
import { Hono } from 'hono';
import { radiusPayments, type RadiusPaymentVariables } from 'radius-sdk/hono';

type Env = { Bindings: { PAY_TO: `0x${string}`; MPP_SECRET_KEY: string }; Variables: RadiusPaymentVariables };
const app = new Hono<Env>();

app.use('/api/*', radiusPayments<Env>({
  network: 'testnet',
  payTo: (c) => c.env.PAY_TO,                       // Workers bindings; process.env.PAY_TO on Node
  routes: {
    'GET /api/lookup': { price: '$0.001', description: 'One lookup' },
    'HEAD /api/lookup': '$0.001',
  },
  onSettled: (receipt, c) => console.log('settled', receipt.transaction, c.req.path),
}));

app.get('/api/lookup', (c) => c.json({ ok: true, paidBy: c.get('radiusPayment')?.payer }));
export default app;                                  // Workers; on Node: serve({ fetch: app.fetch }) from @hono/node-server
```

- Dynamic `payTo`, `price` and `onSettled` receive the Hono context (`c.env`, `c.req`).
- With `settle: 'before'`, the paid handler reads the receipt from `c.get('radiusPayment')`.
- Options other than `payTo`, `price` and `onSettled` are read when the middleware is built, so `mpp.secretKey` cannot come from `c.env` directly. On Workers, build the middleware once, on the first request:

```typescript
let paid: ReturnType<typeof radiusPayments<Env>> | undefined;
app.use('/api/*', (c, next) => (paid ??= radiusPayments<Env>({ network: 'testnet', payTo: (c) => c.env.PAY_TO, mpp: { secretKey: c.env.MPP_SECRET_KEY }, routes }))(c, next));
```
- No `@hono/node-server`? A 10-line bridge works (this is what the eval's reference app does):

```typescript
import { createServer } from 'node:http';
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
  const response = await app.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
```

## Web-standard handler (`radius-sdk/server`)

For Cloudflare Workers without a framework, Bun, Deno, Node 22, and route handlers in Next.js (App Router), SvelteKit, Remix and Astro. `radiusPayments()` returns a `PaymentHandler`:

- `pay(request, next)`: charge if `request` matches a paid route, then call `next(request, payment)`; otherwise call `next` unpaid.
- `pay.wrap(next)`: the same as a single `(request) => Promise<Response>` fetch function.
- `pay.requiresPayment(request)`: true when the request matches a paid route (no I/O).

```typescript
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO as `0x${string}`,
  routes: { 'GET /api/lookup': '$0.001', 'POST /api/query': { price: '$0.01' } },
});

export default { fetch: pay.wrap((request, payment) => Response.json({ ok: true, paidBy: payment?.payer })) };
```

**Next.js App Router route handler** (the recommended Next.js path: same tested code, MPP available):

```typescript
// app/api/report/route.ts
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO as `0x${string}`,
  routes: { 'GET /api/report': '$0.001' },          // matched against the request path
});

export const GET = (request: Request) => pay(request, () => Response.json({ report: 'quarterly-sales' }));
```

**Validate, then charge** (any route handler; `examples/astro-seller` in the SDK does this): do fallible work before `pay`, and return the unpaid 404 there.

```typescript
export const GET = async (request: Request) => {
  const article = await loadArticle(new URL(request.url).searchParams.get('slug'));
  if (!article) return new Response('Not found', { status: 404 });   // nothing charged
  return pay(request, () => Response.json(article));                 // charge, then deliver
};
```

Building `radiusPayments()` at module scope does no I/O (safe on Workers): the facilitator's `/supported` is read on the first paid request after each cold start.

## Express (`createRadiusServer` + `@x402/express`)

```typescript
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { createRadiusServer } from 'radius-sdk/server';

const radius = createRadiusServer({
  network: 'testnet',
  facilitator: process.env.RADIUS_FACILITATOR_URL ? { url: process.env.RADIUS_FACILITATOR_URL } : undefined,
  onSettled: (receipt) => console.log('settled', receipt.transaction, receipt.payer),
});

const app = express();
app.set('trust proxy', true);                         // behind a TLS proxy, so resource.url says https
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(paymentMiddleware(
  radius.routes({
    payTo: process.env.PAY_TO as `0x${string}`,
    routes: { 'GET /api/report': { price: '$0.001', description: 'Quarterly report' }, 'HEAD /api/report': '$0.001' },
  }),
  radius.server,
));
app.get('/api/report', (_req, res) => res.json({ report: 'quarterly-sales' }));   // after app.use(...)
app.listen(Number(process.env.PORT ?? 3000));
```

- `app.use(paymentMiddleware(...))` must come **before** the paid routes; a route registered earlier is served free.
- Dynamic `payTo` / `price` receive the x402 request context (`ctx.adapter.getUrl()`, `ctx.adapter.getHeader(name)`), not `req`.
- `onSettled` receives the x402 context; `requestOf(context)` is `undefined` under this adapter.
- `mpp` is accepted by `createRadiusServer` but `@x402/express` only speaks x402: no MPP challenge is sent.
- The adapter fetches `/supported` when it is constructed (its `syncFacilitatorOnStart` default). That is fine on Node.
- The handler does not receive the receipt; read it in `onSettled`.

## Next.js middleware and proxy (`radiusPayments`)

Use `radiusPayments()` from `radius-sdk/server` in `middleware.ts` (Next 15) or `proxy.ts` (Next 16). Earlier Next versions with middleware were not tested. It is the recommended path for gating pages (ISR, static, dynamic, Pages Router): MPP works, nothing beyond `radius-sdk` is installed, and it runs on Next 15. The seller eval runs it on Next 15.5.27 in the edge runtime (`SELL-NEXT-MW`).

```typescript
// middleware.ts (Next 15). On Next 16 name the file proxy.ts and export `proxy` instead of `middleware`.
import { NextResponse, type NextRequest } from 'next/server';
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO as `0x${string}`,
  facilitator: process.env.RADIUS_FACILITATOR_URL ? { url: process.env.RADIUS_FACILITATOR_URL } : undefined,
  mpp: process.env.MPP_SECRET_KEY ? { secretKey: process.env.MPP_SECRET_KEY } : undefined,
  routes: {
    'GET /articles/*': { price: '$0.001', description: 'One article' },
    'HEAD /articles/*': '$0.001',                      // price HEAD too: see gotchas
  },
});

/** `next start` builds req.url from its own hostname, so resource.url would say localhost: rebuild the public URL. */
function publicRequest(req: NextRequest): Request {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return req;
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  return new Request(`${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`, { method: req.method, headers: req.headers });
}

export async function middleware(req: NextRequest) {
  return pay(publicRequest(req), () => NextResponse.next());     // charge, then let Next render the page
}

export const config = { matcher: ['/articles/:path*', '/_next/data/:path*'] };
```

- **Edge or Node runtime.** The default edge runtime works (`ƒ Middleware` in the build output, `edge-runtime-webpack.js` in the manifest). On Next 15.5, `export const config = { runtime: 'nodejs', matcher: [...] }` also worked when run by hand. Build `radiusPayments()` at module scope as above: it does no I/O.
- **`NextResponse.next()`** is the "handler": the SDK settles first, then Next renders the page, including ISR and fully static pages. A paid request does not poison Next's ISR cache: an unpaid request right after a paid one still gets the 402 (eval).
- **Matcher.** Include every page path you charge for, and `/_next/data/:path*` for Pages Router sites. Next matches data requests (`/_next/data/<buildId>/legacy/one.json`) and RSC requests (`?_rsc=`, the `RSC` header) as the page path, so the route key `'GET /legacy/*'` covers them. The eval gates the JSON data URL and an RSC request with the page's route key alone. On Next 15.5.27 the data URL was also gated when `/_next/data/:path*` was left out of the matcher (checked by hand), because Next adds the data-URL prefix to each matcher, but listing it is harmless.
- **Price `HEAD`** next to each `GET`, as everywhere (gotchas, item 1). The eval confirms an unpaid HEAD gets a 402 on ISR, static and dynamic pages.
- **Public URL.** Without `publicRequest`, `pay(req, ...)` puts `http://localhost:<port>` into `resource.url` when the app is self-hosted behind a proxy, and `radius-cli sell check` fails the `resource` check on the deployed URL. Payments still settle. The eval records this as a known gap and shows that the rebuilt request names the forwarded host. On Vercel, `request.url` in production was not tested.
- **A missing page is still charged.** The middleware settles before Next renders and `NextResponse.next()` always looks like a 200 to the SDK, so a 404 page is paid for. Only charge pages that exist: check the slug against a known list, a manifest or your CMS before calling `pay`, and return `NextResponse.next()` unpaid for the rest, as the eval fixture does (a free 404, no challenge). `settle: 'after'` does not help in middleware: the eval shows a paid request for a missing page still settles, because the response `next()` returns is a 200.
- **Next 16.** `proxy.ts` ran the same code in Next 16.4.0 by hand (x402 and MPP paid 200, `sell check` clean). It is not in the eval.

### `@x402/next`

`@x402/next` (`paymentProxy` with `radius.routes(...)` and `radius.server`) needs `next >= 16.2.6`, serves x402 only (no MPP challenge) and pulled in 809 packages in a trial install, so use it only on Next 16.2.6 or later when you do not need MPP. On Next 15, use `radiusPayments()` in middleware as above. In the same trial it paid 200 on Next 16.4, but `sell check` failed `resource.url` (`localhost`). It is not in this repository's eval.

```typescript
// proxy.ts: Next >= 16.2.6, x402 only
import { paymentProxy } from '@x402/next';
import { createRadiusServer } from 'radius-sdk/server';

const radius = createRadiusServer({ network: 'testnet' });
export const proxy = paymentProxy(
  radius.routes({ payTo: process.env.PAY_TO as `0x${string}`, routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001' } }),
  radius.server,
);
export const config = { matcher: ['/articles/:path*'] };
```

Check `@x402/next`'s README for the export name of your Next version. `radius.http({ payTo, routes })` returns an `x402HTTPResourceServer` for adapters' `…FromHTTPServer` variants.

## Astro middleware (SSR)

Gate pages with `src/middleware.ts` when the site is server-rendered (`output: 'server'`, or per-page `prerender = false` with an adapter):

```typescript
// src/middleware.ts (Astro 5)
import { defineMiddleware } from 'astro:middleware';
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO as `0x${string}`,
  mpp: process.env.MPP_SECRET_KEY ? { secretKey: process.env.MPP_SECRET_KEY } : undefined,
  routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001' },
});

export const onRequest = defineMiddleware((context, next) => {
  if (context.isPrerendered) return next();         // Astro 5: the build-time render of a prerendered page
  return pay(context.request, () => next());        // charge, then render the page
});
```

> **Warning: prerendered pages are not gated, and an unguarded middleware can corrupt them.**
> - A page with `export const prerender = true` is built once and served as a static file by the adapter. The request-time middleware does not gate it: an unpaid request gets the page with `200` and `Cache-Control: public, max-age=0`. Keep every route you charge for server-rendered: `export const prerender = false` (the default with `output: 'server'`).
> - The build renders prerendered pages **through the middleware**. Without the guard, `pay` answers that build-time request with its `402` and Astro writes the 402 body into the built page (`dist/client/<page>/index.html` contained `{}`, or an error JSON when the facilitator was unreachable). The build still exits 0. Humans then get a broken page, silently. Check the built HTML after the first build.
> - **Astro 4** has no `context.isPrerendered`. A build-time render has no `Host` header, so guard with `if (!context.request.headers.get('host')) return next();`.

Both guards and the unguarded failure are exercised by `SELL-ASTRO-MW` (Astro 4.15.12 and 5.18.1 on `@astrojs/node`).

- **Public URL on Astro 5.** Astro 5 ignores `Host` and `X-Forwarded-Host` when it builds `request.url` unless `security.allowedDomains` names the host, so `resource.url` says `http://localhost/...` and `sell check` fails. With `security: { allowedDomains: [{ hostname: 'www.example.com' }] }` in `astro.config.mjs`, a request with `X-Forwarded-Host: www.example.com` (and `X-Forwarded-Proto`) produces the right URL (eval). Astro 4.15 honoured `X-Forwarded-Host` and `X-Forwarded-Proto` without configuration.
- **Other adapters.** Only `@astrojs/node` was run. The Netlify adapter's `edgeMiddleware`, which reportedly also runs for prerendered pages, and the Cloudflare adapter were **not tested**.
- **Validate before charging.** The middleware settles before the page renders: see the Next.js note on missing pages. The `astro-seller` example in the SDK validates inside an API route instead.

## In front of an origin: Cloudflare Worker

When the CMS or framework is not yours to change, put a Worker in front and pass only paid requests to the origin. This is the pattern `SELL-WORKER-PROXY` runs (workerd through `wrangler dev`, with a local origin):

```typescript
import { radiusPayments, type PaymentHandler } from 'radius-sdk/server';

interface Env { ORIGIN: string; PAY_TO: `0x${string}`; MPP_SECRET_KEY: string; RADIUS_FACILITATOR_URL?: string }
let pay: PaymentHandler | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Built on the first request: bindings are not readable at module scope.
    pay ??= radiusPayments({
      network: 'testnet',
      payTo: env.PAY_TO,
      facilitator: env.RADIUS_FACILITATOR_URL ? { url: env.RADIUS_FACILITATOR_URL } : undefined,
      mpp: { secretKey: env.MPP_SECRET_KEY },
      routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001' },
    });
    const url = new URL(request.url);
    const toOrigin = (req: Request) => {
      const headers = new Headers(req.headers);
      headers.delete('payment-signature');                                    // do not forward payment credentials
      if (/^payment\s/i.test(headers.get('authorization') ?? '')) headers.delete('authorization');
      return fetch(new Request(env.ORIGIN + url.pathname + url.search, { method: req.method, headers, redirect: 'manual' }));
    };
    return pay(request, toOrigin);                                            // paths outside `routes` pass straight through
  },
};
```

- Unpaid requests get the 402 and the origin is never called. Paid requests return the origin's response with the receipt added.
- **The origin's status is visible here.** The default `settle: 'before'` still charges for an origin 404. `settle: 'after'` charges only when the origin answers below 400; the eval confirms no charge on a 404 and a charge on a 200. Use a second `radiusPayments({ settle: 'after', ... })` for those routes if you want that. The trade-offs of `'after'` are in [settlement.md](settlement.md) and gotchas items 4 and 11.
- **The origin's headers pass through to the payer**, including `Set-Cookie`, `Surrogate-Control`, `CDN-Cache-Control` and `Surrogate-Key`. See [publishers.md](publishers.md) for the caching consequences and the stripping wrapper the eval verifies.
- Gate everything on the Worker route, or add a condition to charge only agents: [publishers.md](publishers.md).

## In front of an origin: Fastly Compute

Verified by hand on Viceroy (`fastly compute serve`, `@fastly/js-compute` 4.0) only: it is **not** in this repository's eval, and no Fastly production service was tried. `@x402/core` calls `AbortSignal.timeout()` and Compute's runtime had no `AbortSignal`, so without a shim every paid route answered `502 facilitator_error: ... AbortSignal is not defined`. With this shim imported first, the 402, an x402 payment and an MPP payment all worked:

```javascript
// src/polyfill.js: import it before 'radius-sdk/server'
if (typeof globalThis.AbortSignal === 'undefined') {
  class AbortSignalShim extends EventTarget {
    constructor() { super(); this.aborted = false; this.reason = undefined; }
    throwIfAborted() {}
    static timeout() { return new AbortSignalShim(); }
    static any() { return new AbortSignalShim(); }
  }
  globalThis.AbortSignal = AbortSignalShim;
}
```

The shim gives up the facilitator timeout. Build the handler lazily (as in the Worker above) and send origin requests through a named backend: `fetch(new Request(origin + path), { backend: 'origin' })`. The facilitator was reached through a dynamic backend locally; whether production services need that enabled per service was **not verified**.

**Fastly services that are VCL only cannot run this.** The gate must live in the origin framework (Next, Astro, Express, a Worker) or in a Compute service in front.
