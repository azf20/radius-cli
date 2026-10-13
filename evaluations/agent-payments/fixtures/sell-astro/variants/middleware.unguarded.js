// No prerender guard: the build renders `prerendered.astro` through this middleware, and `pay` answers that build-time
// request with the 402, which Astro writes into dist/client/prerendered/index.html.
import { defineMiddleware } from 'astro:middleware';
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({
  network: 'testnet',
  payTo: process.env.PAY_TO,
  facilitator: { url: process.env.RADIUS_FACILITATOR_URL },
  mpp: { secretKey: process.env.MPP_SECRET_KEY },
  routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001', 'GET /prerendered': '$0.001', 'HEAD /prerendered': '$0.001' },
});

export const onRequest = defineMiddleware((context, next) => pay(context.request, () => next()));
