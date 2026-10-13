// SELL-NEXT-MW fixture: the Next.js middleware pattern from the sell-api skill (Next 15, edge runtime).
// The same file works as proxy.ts on Next 16.
import { NextResponse } from 'next/server';
import { radiusPayments } from 'radius-sdk/server';

const price = '$0.001';
const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO,
  facilitator: { url: process.env.RADIUS_FACILITATOR_URL },
  mpp: { secretKey: process.env.MPP_SECRET_KEY },
  routes: {
    'GET /articles/*': price, 'HEAD /articles/*': price, // ISR page, validated slugs, public URL rebuilt
    'GET /naive/*': price, 'HEAD /naive/*': price, // the same page, charged with no validation and the raw req.url
    'GET /static': price, 'HEAD /static': price,
    'GET /dynamic': price, 'HEAD /dynamic': price,
    'GET /legacy/*': price, 'HEAD /legacy/*': price, // Pages Router; /_next/data/<id>/legacy/x.json is matched as /legacy/x
  },
});

// settle: 'after' charges once the response is in hand, but NextResponse.next() is always a 200 to the SDK.
const payAfter = radiusPayments({
  network: 'testnet',
  settle: 'after',
  payTo: process.env.PAY_TO,
  facilitator: { url: process.env.RADIUS_FACILITATOR_URL },
  routes: { 'GET /lazy/*': price },
});

const KNOWN_SLUGS = new Set(['hello', 'world']);

/** Agents pay: a payment header, or no browser User-Agent. Humans read free. Spoofable, see references/publishers.md. */
function isAgent(req) {
  if (req.headers.has('payment-signature') || /^payment\s/i.test(req.headers.get('authorization') ?? '')) return true;
  return !/Mozilla\//.test(req.headers.get('user-agent') ?? '');
}

/** `next start` builds req.url from its own hostname; rebuild the public URL so resource.url is right. */
function publicRequest(req) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return req;
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  return new Request(`${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`, { method: req.method, headers: req.headers });
}

export async function middleware(req) {
  if (!isAgent(req)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/naive/')) return pay(req, () => NextResponse.next());
  if (pathname.startsWith('/lazy/')) return payAfter(req, () => NextResponse.next());
  // Settlement happens before Next renders, so a 404 page would still be paid for: only charge known pages.
  if (pathname.startsWith('/articles/') && !KNOWN_SLUGS.has(pathname.split('/')[2])) return NextResponse.next();
  return pay(publicRequest(req), () => NextResponse.next());
}

export const config = { matcher: ['/articles/:path*', '/naive/:path*', '/lazy/:path*', '/static', '/dynamic', '/legacy/:path*', '/_next/data/:path*'] };
