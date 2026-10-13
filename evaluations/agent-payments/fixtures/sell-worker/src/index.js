// SELL-WORKER-PROXY fixture: radiusPayments in a Cloudflare Worker in front of an origin (the sell-api skill's pattern).
// The origin is env.ORIGIN; its response is returned to whoever paid.
import { radiusPayments } from 'radius-sdk/server';

let pay;
let payAfter;
let paySafe;

/** Everything except the payment credentials goes to the origin. */
function forwardHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete('payment-signature');
  if (/^payment\s/i.test(headers.get('authorization') ?? '')) headers.delete('authorization');
  return headers;
}

/** A paid response is for one payer: drop the origin's CDN caching directives and say so in Cache-Control. */
function privateOnly(response) {
  const headers = new Headers(response.headers);
  for (const name of ['surrogate-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control', 'vercel-cdn-cache-control', 'surrogate-key']) headers.delete(name);
  headers.set('cache-control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    // Built on the first request: Workers forbid I/O (and env access) at module scope.
    const options = (settle, prefix) => ({
      network: 'testnet',
      settle,
      payTo: env.PAY_TO,
      facilitator: { url: env.RADIUS_FACILITATOR_URL },
      mpp: { secretKey: env.MPP_SECRET_KEY },
      routes: { [`GET ${prefix}/*`]: '$0.001', [`HEAD ${prefix}/*`]: '$0.001' },
    });
    pay ??= radiusPayments(options('before', '/articles'));
    // /after/* maps to the same origin pages, but settles only if the origin answered < 400 (the origin's status is visible here).
    payAfter ??= radiusPayments(options('after', '/after'));
    // /safe/* is /articles/* with the origin's CDN caching headers removed from the paid response.
    paySafe ??= radiusPayments(options('before', '/safe'));

    const url = new URL(request.url);
    const toOrigin = (req) => fetch(new Request(env.ORIGIN + url.pathname.replace(/^\/(after|safe)\//, '/articles/') + url.search, {
      method: req.method, headers: forwardHeaders(req), redirect: 'manual',
    }));
    if (url.pathname.startsWith('/after/')) return payAfter(request, toOrigin);
    if (url.pathname.startsWith('/safe/')) return privateOnly(await paySafe(request, toOrigin));
    return pay(request, toOrigin);
  },
};
