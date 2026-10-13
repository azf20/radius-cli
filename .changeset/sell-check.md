---
'radius-cli': minor
---

`sell check <url>` checks a seller's `402` without paying: it decodes the x402 `PAYMENT-REQUIRED` offers and any MPP `WWW-Authenticate: Payment` challenge, checks each offer's network, asset and EIP-712 domain, amount (against `--price`, at the asset's decimals), `payTo`, `resource.url` and `maxTimeoutSeconds`, reads the facilitator's `/supported` (`--facilitator`, default the network's) for each offer's scheme, network and transfer method, and asks the SDK buyer whether it would pay. `--probe-head` warns when an unpaid `HEAD` is served, and `--pay --threshold` makes one paid request (testnet unless `--network mainnet`) and checks the receipt. Prints a checklist or, with `--json`, a report; exits 1 when a check fails.
