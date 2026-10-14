// Reference one-shot integration (Express): what a coding agent should produce from PROMPT.md.
// The SDK supplies the Radius resource server; the upstream @x402/express adapter supplies the middleware.
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { createRadiusServer } from 'radius-sdk/server';

const payTo = process.env.PAY_TO as `0x${string}` | undefined;
if (!payTo) throw new Error('Set PAY_TO to the seller address');
const facilitatorUrl = process.env.RADIUS_FACILITATOR_URL;

const radius = createRadiusServer({ network: 'testnet', facilitator: facilitatorUrl ? { url: facilitatorUrl } : undefined });

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.use(
  paymentMiddleware(
    radius.routes({ payTo, routes: { 'GET /api/report': { price: '$0.001', description: 'Quarterly sales report', mimeType: 'application/json' } } }),
    radius.server,
  ),
);
app.get('/api/report', (_req, res) => {
  res.json({ report: 'quarterly-sales', total: 1234 });
});

app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
