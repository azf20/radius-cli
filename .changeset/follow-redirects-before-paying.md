---
"radius-sdk": minor
"radius-cli": minor
---

`createRadiusFetch` and `wallet pay` follow redirects before paying, so an endpoint that answers `302` with a redirect to a `402` is paid at the final URL. `createRadiusFetch` takes `maxRedirects` (default 20, like fetch; 0 follows none) and `wallet pay` takes `--max-redirects <n>` (default 1). A longer chain throws `redirect_refused`.
