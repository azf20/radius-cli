---
'radius-sdk': minor
---

`proxyTo(origin)` (from `radius-sdk/server` and `radius-sdk/hono`) forwards a request to an origin you do not change, for a seller in front of it: `pay.wrap(proxyTo(origin))`, or `app.all('/*', (c) => toOrigin(c.req.raw))` after the Hono middleware. It keeps the method, path and query, buffers the body (a stream body needs `duplex` on Node), drops `Host`, hop-by-hop headers (Node's `fetch` throws on `Keep-Alive`, `Expect` and others) and payment credentials, asks for `Accept-Encoding: identity` (Node's `fetch` decodes gzip but keeps `Content-Encoding`), returns redirects unfollowed, and copies the response headers so the receipt can be added.
