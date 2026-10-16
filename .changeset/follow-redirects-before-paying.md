---
"radius-sdk": patch
"radius-cli": patch
---

`createRadiusFetch` and `wallet pay` pay the 402 at the final URL when the first request was redirected, so an endpoint that answers `302` with a redirect to a `402` can be paid. The redirects are followed by `fetch` itself (its limit of 20, not configurable).
