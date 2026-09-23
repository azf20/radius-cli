---
"radius-sdk": patch
---

Make viem an optional peer dependency so buyer applications can supply their existing compatible installation. Remove its runtime import from shared network definitions so root and Hono seller imports no longer load viem. Document entry-point dependencies and add runtime import-isolation checks. Upstream x402 dependencies can still install viem transitively.
