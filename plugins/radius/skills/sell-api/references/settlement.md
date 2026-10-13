# Settlement order, receipts, paid errors and replays

## `settle: 'before'` (default)

1. Unpaid request → `402` with the challenge; the handler does not run.
2. Paid request → the facilitator's `/settle` (no separate `/verify`). Settlement failed or was rejected → `402`, handler not run. Facilitator unreachable, timed out or dropped the connection → `502` (unknown outcome), handler not run.
3. Settled → the handler runs with the receipt (`payment` argument of `pay(request, next)` / `pay.wrap`, or `c.get('radiusPayment')` on Hono), and the response carries `PAYMENT-RESPONSE` (MPP: `Payment-Receipt`) and `Cache-Control: private`.

Paid bodies stream through untouched (good for SSE and token streams).

**A paid error is still paid.** If the handler then returns 404 or 500, or throws, the money has already moved: the SDK returns that status *with the receipt* so the buyer can reconcile instead of paying again (a thrown error becomes a `500` with the receipt). So:

- Do fallible work (lookups, validation, upstream calls you can make first) **before** the payment handler runs, and return unpaid 4xx there. With `radius-sdk/server`: `if (!item) return new Response('Not found', { status: 404 }); return pay(request, () => …)`.
- Record delivery failures next to the receipt's `transaction`, so support can refund or re-deliver.

## `settle: 'after'`

1. Paid request → `/verify`. Invalid → `402`; the handler never runs.
2. Valid → the handler runs **before** money moves. The response body is buffered (no streaming).
3. Handler answered `< 400` → `/settle`. Success → the buffered response with `PAYMENT-RESPONSE`. Settlement rejected → `402`; unknown outcome → `502`. In both cases the body is withheld.
4. Handler answered `>= 400` (or threw) → nothing is settled; the error goes back unpaid.

Use it only when the handler's work is cheap to throw away: two concurrent requests with the same payment are both verified and both run the handler; one settles and is delivered, the other's settlement fails and its body is withheld. Response **headers** of a failed settlement can still leak on Hono and Express (see [gotchas.md](gotchas.md)).

## `onSettled`

```typescript
radiusPayments({ …, onSettled: async (receipt, request) => { await db.payments.insert({ tx: receipt.transaction, payer: receipt.payer, amount: receipt.amount, network: receipt.network, path: new URL(request.url).pathname }); } });
```

- Called once per settled payment, whichever wrapper served it: with the `Request` (`radius-sdk/server`), the Hono context (`radius-sdk/hono`), or the x402 request context (`createRadiusServer`; `requestOf(context)` is `undefined` under upstream adapters).
- It records **settlement, not delivery**: in `'before'` mode it fires before the handler runs, and the handler can still fail.
- An error it throws is logged (`radius-sdk onSettled hook failed`) and does not change the response. Do not rely on it to block delivery.
- The receipt (`PaymentReceipt`): `success`, `protocol` (`'x402'` / `'mpp'`), `transaction`, `network`, `payer`, `amount`, `explorerUrl`.

A facilitator's `success` reports a submitted settlement. When you need independent proof, reconcile `transaction` on chain (`getSettlement(network, txHash)` from `radius-sdk/client`, or `radius-cli receipt <tx>`).

## Unknown outcomes (`502`)

A facilitator that times out (`facilitator: { timeoutMs }`), drops the connection, or answers with something that is not an x402 response leaves the outcome unknown: the settlement may have reached the chain. The SDK answers `502` (`facilitator_error`), never `402`, so a buyer does not read it as "rejected, nothing moved". Log these with the request and payer; a buyer that retries signs a new authorization.

## Replays and idempotency

- The seller keeps **no replay cache and no idempotency store**. Replay protection is the authorization's nonce: the facilitator and the chain refuse a second settlement of the same EIP-3009 or Permit2 authorization, and MPP challenges bind the nonce.
- In `'before'` mode a replayed header fails at `/settle`, so the handler runs once per payment, also under concurrency.
- In `'after'` mode a concurrent replay runs the handler twice and delivers once (see above): make paid handlers idempotent or side-effect free there.
- If your own system needs exactly-once side effects per payment, key them by `receipt.transaction` (or payer + nonce) in your database.

## Caching

Paid responses get `private` added to `Cache-Control` so a shared cache does not hand paid content to the next caller, and the 402 is `no-store`. A handler's own `public` directive is kept next to `private`, and on Hono a handler's `Cache-Control` replaces the SDK's `private`. Do not mark paid responses `public`.
