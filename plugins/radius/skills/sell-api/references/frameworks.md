# Framework wrappers

Every wrapper takes the same route table and options; only the glue differs. Pick by what the project already uses. All examples target Radius testnet and read the recipient from `PAY_TO`.

| Wrapper | Package | Tested by this repo | Serves MPP |
| --- | --- | --- | --- |
| `radiusPayments()` web-standard handler | `radius-sdk/server` | unit tests, seller eval (`web`) | yes |
| `radiusPayments()` Hono middleware | `radius-sdk/hono` | unit tests, seller eval (`hono`) | yes |
| `createRadiusServer()` + `@x402/express` | `radius-sdk/server`, `@x402/express` | unit tests, seller eval (`express`) | no |
| `createRadiusServer()` + `@x402/next` | `radius-sdk/server`, `@x402/next` | **no** | no |

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

## Next.js middleware (`@x402/next`) — not covered by this repo's tests

The SDK's resource server plugs into `@x402/next` the same way as into Express (`radius-sdk` documents `paymentProxy` from `@x402/next` taking `radius.routes(...)` and `radius.server`), but `@x402/next` is not installed in this workspace and no test or eval runs it. Prefer App Router route handlers with `radius-sdk/server` (above). If the user needs middleware:

```typescript
// middleware.ts — check @x402/next's README for the export and file name of your Next.js version
import { paymentProxy } from '@x402/next';
import { createRadiusServer } from 'radius-sdk/server';

const radius = createRadiusServer({ network: 'testnet' });
export const middleware = paymentProxy(
  radius.routes({ payTo: process.env.PAY_TO as `0x${string}`, routes: { 'GET /api/report': '$0.001' } }),
  radius.server,
);
export const config = { matcher: ['/api/:path*'] };
```

Verify it with `radius-cli sell check` before relying on it; MPP is not available on this path. `radius.http({ payTo, routes })` returns an `x402HTTPResourceServer` for adapters' `…FromHTTPServer` variants.
