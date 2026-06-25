/**
 * Outbound-URL safety for admin-configured endpoints (the broker URL and premium
 * webhook targets), which are passed to `fetch()`.
 *
 * Design note — why we DON'T block private ranges: OmniProject's broker and
 * webhook targets are legitimately internal in self-hosted deployments (e.g.
 * `http://n8n:5678` on the compose network, or a loopback dev endpoint), so
 * blanket-blocking RFC1918/loopback would break normal installs. What is never a
 * legitimate target is the cloud-metadata / link-local range (169.254.0.0/16,
 * which includes the 169.254.169.254 IMDS endpoint, and IPv6 fe80::/10), so we
 * reject those and require a well-formed http(s) URL. This blunts the worst SSRF
 * vector — metadata-credential theft — without breaking internal brokers.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Throw `UnsafeUrlError` unless `raw` is a well-formed, non-metadata http(s) URL. */
export function assertSafeOutboundUrl(raw: string, label = "URL"): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`${label} is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`${label} must use http or https`);
  }
  // Hostname may be bracketed for IPv6; strip brackets for the prefix checks.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // IPv4 link-local / cloud metadata (169.254.0.0/16) and IPv6 link-local (fe80::/10).
  // Node canonicalises numeric IPv4 forms (decimal/hex/octal) back to dotted-decimal,
  // so /^169\.254\./ catches those. It also folds an IPv4-mapped IPv6 literal
  // ([::ffff:169.254.169.254]) to its hex form ::ffff:a9fe:a9fe (a9fe == 169.254),
  // so the mapped link-local range is rejected explicitly too.
  if (
    /^169\.254\./.test(host) ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    host === "fe80::" ||
    /^::ffff:a9fe:/.test(host) ||
    /^::ffff:169\.254\./.test(host)
  ) {
    throw new UnsafeUrlError(`${label} targets a link-local/metadata address, which is not allowed`);
  }
}

/** Non-throwing predicate form of {@link assertSafeOutboundUrl}. */
export function isSafeOutboundUrl(raw: string): boolean {
  try {
    assertSafeOutboundUrl(raw);
    return true;
  } catch {
    return false;
  }
}
