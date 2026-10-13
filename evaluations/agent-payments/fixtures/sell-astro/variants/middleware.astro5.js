// Astro 5: skip the build-time render of prerendered pages with context.isPrerendered.
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
  if (context.isPrerendered) return next();
  return pay(context.request, () => next());
});
