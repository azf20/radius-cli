# Publishers: charge agents, keep humans free

For a site that sells articles or pages (a CMS, a news site, documentation) and wants AI crawlers and agents to pay while readers do not. The wrappers are in [frameworks.md](frameworks.md): `radiusPayments()` in Next.js or Astro middleware, or in a Worker or Compute service in front of the origin. This page covers what is different for content.

How to read it: statements marked **eval** come from `pnpm eval:payments:sell` (`SELL-NEXT-MW`, `SELL-ASTRO-MW`, `SELL-WORKER-PROXY`, `SELL-SELECTIVE`), which run the real SDK, framework and buyer against a mock facilitator. **Not tested** marks behavior taken from vendor documentation or reasoning: Netlify edge middleware, Vercel production, Cloudflare and Fastly cache behavior, Piano and Zephr, and real chain settlement.

## 1. Where the gate goes

| The site runs | Put the gate in | Notes |
| --- | --- | --- |
| Next.js (self-hosted or Vercel) | `middleware.ts` / `proxy.ts` | Also gates ISR, static, RSC and `/_next/data` requests (eval). |
| Astro with a server adapter | `src/middleware.ts` | Only server-rendered pages. Prerendered pages are not gated: see the warning in frameworks.md. |
| A CMS or framework you cannot change | A Cloudflare Worker (or Fastly Compute service) in front | The gate runs before the origin and, if the Worker is on the cached path, before the CDN cache. |
| Fastly with VCL only | The origin framework, or a Compute service | VCL cannot run the SDK. |
| Netlify edge middleware, Vercel middleware | Not tested | Documentation says both run before the CDN cache; neither was run here. |

Wherever it goes, the gate must run **before the cache** (section 4) and charge only pages that exist (section 8).

## 2. Humans free, agents pay

`radiusPayments()` charges every request that matches a route. To charge only some clients, run it only for those requests. This wrapper is the one `SELL-SELECTIVE` runs (`evaluations/agent-payments/fixtures/sell-selective/gate.mjs` in the repository):

```typescript
import { radiusPayments } from 'radius-sdk/server';

const pay = radiusPayments({ network: 'testnet', payTo: process.env.PAY_TO as `0x${string}`, routes: { 'GET /articles/*': '$0.001', 'HEAD /articles/*': '$0.001' } });

const AI_AGENT_UA = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|CCBot|Bytespider|Amazonbot|meta-externalagent|Diffbot/i;

function isAgent(request: Request): boolean {
  if (request.headers.has('payment-signature') || /^payment\s/i.test(request.headers.get('authorization') ?? '')) return true; // a payment is always handled
  if (request.headers.has('signature-agent')) return true;                       // Web Bot Auth claim
  const ua = request.headers.get('user-agent') ?? '';
  return AI_AGENT_UA.test(ua) || !/^Mozilla\//.test(ua);                          // known agent, or not a browser
}

export function gate(request: Request, origin: (request: Request) => Promise<Response>, isSubscriber: (request: Request) => boolean) {
  if (isSubscriber(request)) return origin(request);   // verified subscribers read free
  if (!isAgent(request)) return origin(request);        // humans read free
  return pay(request, origin);                          // charge, then serve the same page
}
```

In Next middleware the `origin` is `() => NextResponse.next()`; in a Worker it is the `fetch` to the origin. The eval checks, over HTTP with the real buyer:

- A browser User-Agent gets the page with no challenge and the facilitator is never called. A browser `HEAD` is free too.
- GPTBot, ChatGPT-User and ClaudeBot UAs, a script UA, the default `node` UA, and a browser UA with a `Signature-Agent` header get a `402` (`no-store`, no content). A bot `HEAD` gets a `402`.
- A bot pays over x402 and over MPP and gets the page; the origin runs once per paid request.
- A payment header sent with a browser UA is still verified and settled, so a payment is never silently dropped by the predicate.
- `radius-cli sell check URL --price '$0.001' -H 'User-Agent: GPTBot/1.1'` passes, and the same command with a browser User-Agent fails (that request is served without payment), which is how you check that humans stay free.

## 3. Who counts as an agent

**Header and User-Agent checks are claims, not proof.** An agent that sends a browser User-Agent reads for free. The eval records this as a documented limitation, not a bug: the spoofed request got the page with no charge. Use the safe direction: let a claim make a request *pay* (a bot UA, a `Signature-Agent` header), and let only a **verified** credential make it *free* (a subscriber session you validate, a verified bot signature). Presence of a cookie proves nothing: the eval's forged `session=` cookie gets a `402`, the valid one does not, because the fixture checks the value against the subscriber store.

- **Training versus retrieval.** Crawlers that collect training data, search indexers and agents fetching a page for one user are separate user agents at the large vendors, for example `GPTBot` (training), `OAI-SearchBot` (search) and `ChatGPT-User` (a user's request) at OpenAI, `ClaudeBot`, `Claude-SearchBot` and `Claude-User` at Anthropic, and `PerplexityBot` and `Perplexity-User` at Perplexity. Which of them you charge, allow free or refuse is a business decision, and a publisher may price them differently by branching on the token. The list above is the vendors' published tokens as of this writing; they change, so read each vendor's current documentation.
- **Web Bot Auth (`Signature-Agent`).** Agents that sign their requests (HTTP message signatures with a `Signature-Agent` header naming where their keys are published) can be verified. The SDK does **not** verify signatures: the wrapper above only treats the header as a claim and charges. To make a verified bot free or to trust its identity, verify the signature yourself or use your CDN's verification.
- **Cloudflare.** On plans with Bot Management, a Worker can read `request.cf.botManagement` (for example `verifiedBot`) and the verified-bots categories. Not exercised here: workerd's local `wrangler dev` has no bot data.
- **Subscribers.** Check the subscriber's credential at the gate, before the agent test, as the wrapper does. A subscriber who is also an agent is free.

## 4. CDN caching

What the SDK does today (eval, Worker and Next cases):

| Response | Headers |
| --- | --- |
| Unpaid `402` | `Cache-Control: no-store`; no content; the origin is never called |
| Paid `200` | the origin's `Cache-Control` with `private` appended (`public, s-maxage=600` became `public, s-maxage=600, private`); every other origin header is passed through unchanged, including `Surrogate-Control`, `CDN-Cache-Control`, `Surrogate-Key` and `Set-Cookie` |
| Free human page | whatever the origin sends. A Next.js ISR page sends `s-maxage=60, stale-while-revalidate=...`, which a CDN that caches HTML may store |

What that means (from CDN documentation, **not tested here**: no real CDN was run):

- **The free response can be served to agents.** If a CDN in front of the origin caches the human HTML, the cached copy goes to agent requests too and the gate behind it never runs. Put the gate **before** the cache (a Worker, a Compute service, edge middleware that runs ahead of cache lookup), or make agent traffic bypass the HTML cache with a cache rule on the same predicate (as spoofable as the predicate).
- **A paid response may be cached.** `private` is appended to `Cache-Control`, but Fastly documents `Surrogate-Control` and Cloudflare documents `CDN-Cache-Control` as taking precedence over it, and the SDK leaves both in place. A cacheable paid page can then be served to the next unpaid request.
- **Next.js's own ISR cache** was not poisoned: an unpaid request after a paid one still got the `402` (eval). That is the framework cache, not a CDN, and Astro's was not tested.

Until the SDK strips these itself, remove them from paid responses in the Worker or Compute layer. This wrapper is verified by `SELL-WORKER-PROXY` (the paid response had no `Surrogate-Control`, `CDN-Cache-Control` or `Surrogate-Key`, and `Cache-Control: private, no-store`):

```typescript
function privateOnly(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of ['surrogate-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control', 'vercel-cdn-cache-control', 'surrogate-key']) headers.delete(name);
  headers.set('cache-control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
// return privateOnly(await pay(request, toOrigin));
```

The origin's `Set-Cookie` also reaches the payer (eval). Strip origin session cookies in the same place if the payer should not receive them. For middleware inside the origin framework (Next, Astro) there is no layer to strip headers in: set `Cache-Control: private, no-store` on paid paths from the origin, and keep CDN-specific headers off those paths.

## 5. Coexisting with Piano and Zephr

Not tested against either product. Reasoning only:

- A **client-side** paywall (a script that hides the article after it loads) leaves the full HTML in the response, so an agent that does not run scripts already reads everything. The payment gate in front is the actual protection, and it should run before the page is served.
- A paywall that decides **on the server or at the CDN edge** (Zephr is commonly deployed that way) makes its own free or blocked decision. Decide the order once: for agents, the payment gate should answer first, and verified subscribers should reach neither gate. Check where your paywall runs before choosing where the gate goes.

## 6. Assets on other domains

The gate only sees requests to your own domain. Images and files on a third-party CDN (for example `cdn.sanity.io`, or an image CDN behind Arc or Strapi) are fetched directly from that CDN and stay free whatever your middleware does. Decide whether that matters for your content. To gate an asset, serve it through your own domain (not tested).

## 7. Discovery

Nothing here is generated for you: no `robots.txt`, no `llms.txt`, no `Content-Signal` line. The default `402` for a browser-like client was an 804-byte HTML "Payment Required" page with no link to pricing or subscription in a manual run. Publish your own terms, for example a `/pricing.md` page listing the paid paths, prices and permitted use (Radius defines no format for it), and point to it from `robots.txt` and `llms.txt`. `Content-Signal` in `robots.txt` states preferences (`ai-train`, `search`, `ai-input`); it is advisory and nothing enforces it. Agents that find the 402 directly need no discovery: it carries the price and where to pay.

## 8. Missing pages and other charge-then-fail cases

Middleware settles **before** the page renders. A request for a page that does not exist is charged and then answered `404` (eval, Next: a paid `/naive/nope` settled and returned `404`). Mitigations, from what the eval ran:

- **Charge only pages you know exist.** Check the slug against a list, a manifest or your CMS inside the middleware, before `pay`, and return `NextResponse.next()` (or `next()`) unpaid for the rest. The eval's `/articles/nope` gets a free `404` and no challenge, and nothing is settled.
- **`settle: 'after'`** charges only when the handler's response is below 400, so it works where the status is visible: a Worker in front of an origin (the eval: a paid `/after/nope` answered `404` and settled nothing, and `/after/hello` settled once). It does **not** help in Next middleware: `NextResponse.next()` is always a `200`, and a paid missing page still settled (eval). Astro middleware in `'after'` mode was not tested.
- The default `settle: 'before'` charges for an origin `404` in a Worker too (eval, recorded as a known gap).

See [settlement.md](settlement.md) for what `'after'` costs.

## 9. Verify

```bash
radius-cli sell check https://example.com/articles/real-slug --price '$0.001' --probe-head -H 'User-Agent: GPTBot/1.1'   # agents pay
radius-cli sell check https://example.com/articles/real-slug -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64)'          # expected to FAIL: humans are served free
```

`sell check` does not look at caching headers or at whether a CDN serves the free copy to agents. Request the page twice from outside the CDN, as an agent, before and after a human has loaded it, and confirm both get a `402`.
