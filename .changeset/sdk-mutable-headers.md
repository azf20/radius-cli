---
'radius-sdk': patch
---

A paid route whose handler returns a `fetch()` response no longer fails after settlement under `@hono/node-server`. The server's global `Response` kept the origin's immutable headers, so adding the receipt threw `TypeError: immutable`: with `settle: 'before'` the payer was charged and got a 500, and with `'after'` a 402. The SDK now copies the headers before it adds the receipt.
