// Reference one-shot integration (Hono): what a coding agent should produce from PROMPT.md.
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { radiusPayments } from 'radius-sdk/hono';

const payTo = process.env.PAY_TO as `0x${string}` | undefined;
if (!payTo) throw new Error('Set PAY_TO to the seller address');
const facilitatorUrl = process.env.RADIUS_FACILITATOR_URL;

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true }));
app.use(
  radiusPayments({
    network: 'testnet',
    facilitator: facilitatorUrl ? { url: facilitatorUrl } : undefined,
    payTo,
    routes: { 'GET /api/report': { price: '$0.001', description: 'Quarterly sales report', mimeType: 'application/json' } },
  }),
);
app.get('/api/report', (c) => c.json({ report: 'quarterly-sales', total: 1234 }));

// Minimal Node bridge for app.fetch (no @hono/node-server needed).
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
  const response = await app.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
