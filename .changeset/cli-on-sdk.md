---
'radius-cli': minor
---

`wallet x402` now pays through `radius-sdk`: Permit2 approvals are gas-sponsored when the server declares `eip2612GasSponsoring`, payments are in SBC only on the configured network, the keystore is unlocked only after a 402 has been parsed and matched, and `--x402-approve-permit2` grants an approval even when sponsored. The hand-rolled x402 client is gone.
