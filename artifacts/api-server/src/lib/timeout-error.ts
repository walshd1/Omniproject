/**
 * Shared predicate for "did this fetch/abort as a timeout?".
 *
 * `AbortSignal.timeout()` (undici/whatwg fetch) rejects with a DOMException whose
 * `name` is "TimeoutError", which is the single signal every call site keys off to
 * distinguish a timed-out request from a plain unreachable one. Kept in one place so
 * the broker, webhook, federation and setup-probe paths agree on the check.
 */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}
