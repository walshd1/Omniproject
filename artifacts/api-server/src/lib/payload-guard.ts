import { BrokerError } from "../broker/types";

/**
 * Egress injection guard for the broker seam (security item: injection hardening).
 *
 * The northbound API validates SHAPES (Zod), but identifiers are `coerce.string()` with
 * no character constraint, and they flow into backend request URLs (the broker
 * interpolates `{{ $json.body.payload.projectId }}` into a real API path) and the
 * forwarded `Authorization` header. So before anything leaves the gateway we assert,
 * centrally and broker-agnostically:
 *
 *  - NO control characters anywhere in the outbound payload or the auth header — this
 *    stops CRLF header/response splitting and NUL truncation (the classic header- and
 *    log-injection vectors).
 *  - Identifier-shaped fields (…Id / …Ref / …Key) carry no URL-structural characters
 *    (`/ ? # & % \\ space` …), so a crafted id can't traverse paths, add query params,
 *    or otherwise reshape the backend request (a path-injection / SSRF-shaping guard).
 *
 * Defence-in-depth: a backend should still parameterise, but a hostile id never reaches
 * it. Throws BrokerError("bad_request") — surfaced as a 400.
 */

// C0 controls + DEL (covers CR, LF, NUL, tab, etc.).
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Characters with structural meaning in a URL path/query — forbidden in an identifier.
const UNSAFE_ID_CHARS = /[/\\?#&%\s\u0000-\u001f\u007f]/;
// Keys whose values are treated as identifiers interpolated into backend URLs.
const ID_KEY = /(?:^id$|Id$|Ref$|Key$)/;

function fail(detail: string): never {
  throw new BrokerError("bad_request", `rejected before egress: ${detail}`);
}

/** Reject an identifier value carrying control or URL-structural characters. */
export function assertSafeIdentifier(name: string, value: string): void {
  if (UNSAFE_ID_CHARS.test(value)) fail(`identifier "${name}" contains an unsafe character`);
}

/** Reject a forwarded auth header carrying control characters (CRLF header injection). */
export function assertSafeAuthHeader(header: string | undefined): void {
  if (header && CONTROL_CHARS.test(header)) fail("authorization header contains a control character");
}

/**
 * Recursively validate an outbound payload: no control characters in any string, and
 * identifier-shaped keys hold no URL-structural characters. Bounded by the payload depth.
 */
export function assertSafeBrokerPayload(value: unknown, keyPath = ""): void {
  if (typeof value === "string") {
    if (CONTROL_CHARS.test(value)) fail(`"${keyPath || "value"}" contains a control character`);
    const leaf = keyPath.split(".").pop() ?? "";
    if (ID_KEY.test(leaf)) assertSafeIdentifier(keyPath, value);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertSafeBrokerPayload(value[i], `${keyPath}[${i}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertSafeBrokerPayload(v, keyPath ? `${keyPath}.${k}` : k);
    }
  }
}
