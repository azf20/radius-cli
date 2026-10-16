---
"radius-sdk": minor
"radius-cli": minor
---

`createRadiusFetch` and `wallet pay` follow redirects before paying, so an endpoint that answers `302` with a redirect to a `402` is paid at the final URL. The new `maxRedirects` option sets how many redirects `createRadiusFetch` follows (20 by default, as fetch does; 0 for none), and `wallet pay` takes `--max-redirects <n>` (or `RADIUS_MAX_REDIRECTS`, or `maxRedirects` in the config file), 1 by default and 0 for none. 307 and 308 keep the method and body; 303, and POST on 301 and 302, become a GET without a body. `Authorization`, `Cookie` and payment headers are dropped on a cross-origin redirect. A longer chain throws `too_many_redirects`, and a redirect without a usable `Location` throws `invalid_redirect`.
