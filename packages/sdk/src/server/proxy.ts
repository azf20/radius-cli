/**
 * `proxyTo(origin)`: forward a request to an origin you do not change, for a seller in front of it
 * (`pay(request, proxyTo(origin))`, or `app.all('/*', (c) => toOrigin(c.req.raw))` on Hono).
 */

/** Hop-by-hop headers (RFC 9110 §7.6.1), plus `expect`: Node's fetch throws on several of them. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect'];

function withoutHopByHop(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of headers.get('connection')?.split(',') ?? []) headers.delete(name.trim());
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
}

/**
 * A fetch function that sends each request to `origin`, keeping its method, path (appended to the
 * origin's path) and query. Free requests pass through as they are; paid ones arrive after the
 * payment handler, with their payment credentials removed.
 *
 * - Request headers: drops `host`, hop-by-hop headers and `content-length`, and the payment
 *   credentials (`PAYMENT-SIGNATURE`, `X-PAYMENT`, `Authorization: Payment …`; other
 *   `Authorization` schemes are forwarded). Sends `Accept-Encoding: identity`, because Node's
 *   `fetch` decodes a compressed body but keeps its `Content-Encoding`.
 * - The body of a non-GET/HEAD request is buffered: a stream body needs `duplex: 'half'` in Node.
 * - Redirects are returned, not followed. The response is a copy with mutable headers (minus
 *   hop-by-hop ones), so the payment handler can add its receipt.
 */
export function proxyTo(origin: string | URL): (request: Request) => Promise<Response> {
  const base = new URL(origin);
  const prefix = base.pathname.replace(/\/$/, '');
  return async (request) => {
    const url = new URL(request.url);
    const target = new URL(base);                                // never resolved against the path: `//host/x` stays on origin
    target.pathname = prefix + url.pathname;
    target.search = url.search;
    const headers = withoutHopByHop(request.headers);
    headers.delete('host');
    headers.delete('content-length');
    headers.delete('payment-signature');
    headers.delete('x-payment');
    if (/^payment\s/i.test(headers.get('authorization') ?? '')) headers.delete('authorization');
    headers.set('accept-encoding', 'identity');
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
    const res = await fetch(target, { method: request.method, headers, body, redirect: 'manual' });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: withoutHopByHop(res.headers) });
  };
}
