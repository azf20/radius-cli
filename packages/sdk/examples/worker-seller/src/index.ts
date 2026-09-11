import { Hono } from 'hono';
import { radiusPayments, type RadiusPaymentVariables } from 'radius-sdk/hono';

type Env = {
  Bindings: { PAY_TO: `0x${string}`; RADIUS_NETWORK: 'mainnet' | 'testnet' };
  Variables: RadiusPaymentVariables;
};

const app = new Hono<Env>();

// Free endpoint.
app.get('/', (c) => c.json({ ok: true, paid: ['GET /api/lookup?ip=…  $0.001', 'POST /api/query  $0.01'] }));

// Everything under /api/* costs money. Config comes from bindings, resolved per request.
app.use(
  '/api/*',
  radiusPayments<Env>({
    network: 'testnet',
    payTo: (c) => c.env.PAY_TO,
    routes: {
      'GET /api/lookup': { price: '$0.001', description: 'Synthetic threat-intel lookup for one IP' },
      'POST /api/query': { price: '$0.01', description: 'Batch query' },
    },
    onSettled: (receipt) => console.log('settled', receipt.transaction, receipt.payer),
  }),
);

// Handlers only run after the payment has settled on Radius.
app.get('/api/lookup', (c) => {
  const ip = c.req.query('ip') ?? '0.0.0.0';
  const payment = c.get('radiusPayment');
  return c.json({ ip, reputation: ip.startsWith('10.') ? 'private' : 'clean', score: 7, paidBy: payment?.payer, tx: payment?.transaction });
});

app.post('/api/query', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ received: body, results: [] });
});

export default app;
