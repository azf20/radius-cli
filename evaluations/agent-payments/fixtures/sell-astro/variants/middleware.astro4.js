// Astro 4 has no context.isPrerendered. The build-time render of a prerendered page has no Host header: skip it.
import { defineMiddleware } from 'astro:middleware';
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO,
  facilitator: { url: process.env.RADIUS_FACILITATOR_URL },
  mpp: { secretKey: process.env.MPP_SECRET_KEY },
  routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001', 'GET /prerendered': '$0.001', 'HEAD /prerendered': '$0.001' },
});

export const onRequest = defineMiddleware((context, next) => {
  if (!context.request.headers.get('host')) return next();
  return pay(context.request, () => next());
});
