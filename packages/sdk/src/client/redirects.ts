import { RadiusPaymentError } from '../errors.js';

/** Redirects `createRadiusFetch` follows before paying, unless `maxRedirects` says otherwise. */
export const DEFAULT_MAX_REDIRECTS = 1;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that describe a request body; dropped when a redirect turns the request into a bodiless GET. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-length', 'content-location', 'content-type'];

/** Credentials and payment headers: never sent to an origin the caller did not address. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'cookie2']);

function isCredentialHeader(name: string): boolean {
  const n = name.toLowerCase();
  return CREDENTIAL_HEADERS.has(n) || n.startsWith('x-payment') || n.startsWith('payment-');
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

export function assertMaxRedirects(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RadiusPaymentError('config', `maxRedirects must be a non-negative integer (got ${String(value)})`);
  }
}

/**
 * The request a redirect leads to. Method and body follow the fetch standard: 307 and 308 repeat
 * the request as it was; 303 turns anything but GET/HEAD into a bodiless GET, and 301 and 302 do
 * so for POST (PUT, PATCH and DELETE keep method and body). Credentials and payment headers are
 * dropped when the target is another origin.
 */
async function redirectRequest(current: Request, status: number, target: URL): Promise<Request> {
  const toGet = status === 303 ? current.method !== 'GET' && current.method !== 'HEAD' : (status === 301 || status === 302) && current.method === 'POST';
  const headers = new Headers(current.headers);
  if (!sameOrigin(target, new URL(current.url))) {
    for (const name of [...headers.keys()]) if (isCredentialHeader(name)) headers.delete(name);
  }
  if (toGet) {
    for (const name of BODY_HEADERS) headers.delete(name);
    return new Request(target, { method: 'GET', headers, signal: current.signal });
  }
  const body = current.body ? await current.clone().arrayBuffer() : undefined;
  return new Request(target, { method: current.method, headers, body, signal: current.signal });
}

/**
 * Send `request` through `send`, following up to `maxRedirects` redirects (301, 302, 303, 307, 308),
 * and return the first response that is not one, with the request that produced it. `Location` is
 * resolved against the current URL; only http and https targets are followed. With `maxRedirects: 0`
 * nothing is followed: a redirect is returned like any other response.
 *
 * Throws `invalid_redirect` for a redirect without a usable `Location` or to another scheme, and
 * `too_many_redirects` when the limit is reached and the response redirects again.
 */
export async function followRedirects(
  request: Request,
  send: typeof globalThis.fetch,
  maxRedirects: number = DEFAULT_MAX_REDIRECTS,
): Promise<{ response: Response; request: Request }> {
  assertMaxRedirects(maxRedirects);
  let current = request;
  for (let followed = 0; ; followed++) {
    // The unsent `current` keeps its body: each hop sends a clone.
    const response = await send(new Request(current.clone(), { redirect: 'manual' }));
    if (maxRedirects === 0 || !REDIRECT_STATUSES.has(response.status)) return { response, request: current };

    const location = response.headers.get('location');
    const details = { status: response.status, location, url: current.url };
    if (!location) {
      throw new RadiusPaymentError('invalid_redirect', `Server redirected ${current.url} (${response.status}) without a Location header`, details);
    }
    let target: URL;
    try {
      target = new URL(location, current.url);
    } catch {
      throw new RadiusPaymentError('invalid_redirect', `Server redirected ${current.url} (${response.status}) to an invalid Location: ${location}`, details);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new RadiusPaymentError('invalid_redirect', `Server redirected ${current.url} (${response.status}) to ${target.protocol}, which is not http or https`, details);
    }
    if (followed >= maxRedirects) {
      throw new RadiusPaymentError(
        'too_many_redirects',
        `Too many redirects: followed ${followed} (the limit), and ${current.url} redirects again to ${target.href}`,
        { ...details, maxRedirects },
      );
    }
    await response.body?.cancel().catch(() => undefined);
    current = await redirectRequest(current, response.status, target);
  }
}
