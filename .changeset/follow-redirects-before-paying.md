---
"radius-sdk": minor
"radius-cli": minor
---

`createRadiusFetch` and `wallet pay` follow redirects before paying, so an endpoint that answers `302` with a redirect to a `402` is paid at the final URL. The new `maxRedirects` option and `--max-redirects <n>` flag (`RADIUS_MAX_REDIRECTS`, or `maxRedirects` in the CLI config file) set how many: 1 by default, 0 for none. 307 and 308 keep the method and body; 303, and POST on 301 and 302, become a GET without a body. `Authorization`, `Cookie` and payment headers are dropped on a cross-origin redirect. A longer chain throws `too_many_redirects`, and a redirect without a usable `Location` throws `invalid_redirect`. The default of 1 is lower than fetch's own limit of 20, so a chain of two or more redirects now needs a higher limit.
