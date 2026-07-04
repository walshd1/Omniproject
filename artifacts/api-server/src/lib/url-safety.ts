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
 *
 * The range check itself lives in `lib/ip-ranges.ts` — shared with `lib/egress.ts`
 * so the two guards can never disagree on what "link-local/metadata" means. This
 * function is intentionally kept SYNCHRONOUS (no DNS resolution): it's called from
 * many places, several of them not already in an async context (e.g. `envUrl` at
 * plain config-read time), so it only catches a literal IP/known-metadata hostname
 * in the URL text, not a plain domain that merely *resolves* to one. Call sites
 * that fetch a LIVE, potentially attacker-influenced URL (the broker, admin-pasted
 * setup probes) go through `lib/egress.ts`'s `assertEgressAllowed`/`safeFetch`
 * instead, which additionally resolves DNS and checks the resolved address(es).
 */
import { isBlockedHostLiteral } from "./ip-ranges";

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
  // Hostname may be bracketed for IPv6; strip brackets for the range check.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedHostLiteral(host)) {
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
