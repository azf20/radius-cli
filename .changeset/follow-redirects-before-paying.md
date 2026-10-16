---
"radius-sdk": minor
"radius-cli": minor
---

`createRadiusFetch` and `wallet pay` handle redirects around a payment. A request whose 402 follows a redirect (fetch follows it, up to its limit of 20) is paid at the final URL, repeating the original method and body, as `@x402/fetch` and `@x402/axios` do. A redirect after payment is followed without the payment header, and the receipt is taken from its `PAYMENT-RESPONSE`. `redirect_refused` is no longer raised.
