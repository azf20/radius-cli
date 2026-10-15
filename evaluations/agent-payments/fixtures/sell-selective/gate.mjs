// SELL-SELECTIVE fixture: humans read free, agents pay. This is the condition wrapper from the sell-api skill's
// references/publishers.md; it runs the payment gate only for requests the predicate selects. Nothing here proves
// who a client is: a header or User-Agent check is a claim, so it deters, it does not enforce.

/** Vendor-published crawler and retrieval-agent User-Agent tokens. Vendors change these; check their documentation. */
export const AI_AGENT_UA = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|CCBot|Bytespider|Amazonbot|meta-externalagent|Diffbot/i;

const hasPaymentHeader = (request) => request.headers.has('payment-signature') || /^payment\s/i.test(request.headers.get('authorization') ?? '');

/** True for a request that should be charged: it carries a payment, claims Web Bot Auth, names a known agent, or does not look like a browser. */
export function isAgent(request) {
  if (hasPaymentHeader(request)) return true; // a payment is always handled, whatever the client claims to be
  if (request.headers.has('signature-agent')) return true; // Web Bot Auth: a claim until the signature is verified
  const ua = request.headers.get('user-agent') ?? '';
  return AI_AGENT_UA.test(ua) || !/^Mozilla\//.test(ua);
}

/**
 * `pay` is a `radiusPayments()` handler and `origin` serves the page. `isSubscriber` must verify the credential
 * (a signed cookie or session lookup): the presence of a cookie proves nothing.
 */
export function createGate({ pay, origin, isSubscriber = () => false }) {
  return (request) => {
    if (isSubscriber(request)) return origin(request);
    if (!isAgent(request)) return origin(request); // humans read free
    return pay(request, origin); // charge, then serve the same page
  };
}
