import { RE2JS } from "re2js";

/**
 * Client mirror of the server's lib/safe-regex.ts — the ONE place the SPA turns a pattern string into
 * a matchable regex, shared by field-validation feedback and (record/UI) search. Keep in step with the
 * server module; the server stays authoritative for enforcement.
 *
 * Backed by RE2 (via the pure-JS `re2js` port): matching is LINEAR in the input, with no backtracking,
 * so no pattern can trigger catastrophic backtracking (ReDoS). RE2 is a subset of PCRE — backreferences
 * and lookaround aren't supported and such a pattern simply reports as invalid. Structured checks (date
 * ranges, number bounds) are typed, never regex.
 */

/** Resource-sanity cap (RE2 is linear-time, so this is not a ReDoS control). */
export const MAX_PATTERN_LENGTH = 1000;

/** Is `source` a valid, compilable RE2 pattern within the length cap? */
export function isSafePattern(source: string): boolean {
  if (typeof source !== "string" || source.length > MAX_PATTERN_LENGTH) return false;
  try {
    RE2JS.compile(source);
    return true;
  } catch {
    return false;
  }
}

/** Search-semantics (`RegExp.test`-like) match, linear-time. Unsafe/invalid ⇒ false, no throw. */
export function patternMatches(source: string, value: string): boolean {
  if (!isSafePattern(source)) return false;
  return RE2JS.compile(source).matcher(value).find();
}

/** Case-insensitive "does `value` match `source`?" for search boxes. Unsafe/invalid ⇒ false, no throw. */
export function safeSearch(source: string, value: string): boolean {
  if (!isSafePattern(source)) return false;
  return RE2JS.compile(source, RE2JS.CASE_INSENSITIVE).matcher(value).find();
}
