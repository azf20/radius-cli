---
"radius-sdk": minor
"radius-cli": minor
---

`createRadiusFetch` and `wallet pay` handle redirects around a payment. A GET or HEAD whose 402 follows a redirect is paid at the final URL (fetch follows the redirect itself, up to its limit of 20); any other method throws `redirect_refused`. A redirect after payment is followed without the payment header, and the receipt is taken from its `PAYMENT-RESPONSE`.
