import { RE2JS } from "re2js";

/**
 * The ONE place we turn a (usually admin-supplied) pattern string into a matchable regex. Centralised
 * so every regex use — field-validation rules today, record/UI search next — shares the same robust,
 * proven engine instead of scattering bare `new RegExp(...)`. The client mirrors this module
 * (artifacts/omniproject/src/lib/safe-regex.ts); keep the two in step.
 *
 * We use RE2 (Google's regex engine, via the pure-JS `re2js` port). RE2 matches in time LINEAR in the
 * input — it has no backtracking — so a pattern can never trigger catastrophic backtracking (ReDoS) no
 * matter how it's crafted. That's why we no longer hand-roll a "looks dangerous" heuristic: the engine
 * is safe by construction. RE2 is a well-defined subset of PCRE — it omits backreferences and
 * lookaround; a pattern using those simply fails to compile and is reported as invalid.
 *
 * Structured checks (date ranges, number bounds) are typed validators (`lib/validate`), never regex.
 */

/** A generous cap — RE2 is linear-time so this is resource sanity, not a ReDoS control. */
export const MAX_PATTERN_LENGTH = 1000;

export class UnsafeRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRegexError";
  }
}

/** Throw {@link UnsafeRegexError} if `source` is over-long or not a valid RE2 pattern. */
export function assertSafePattern(source: string): void {
  if (typeof source !== "string") throw new UnsafeRegexError("pattern must be a string");
  if (source.length > MAX_PATTERN_LENGTH) throw new UnsafeRegexError(`pattern too long (max ${MAX_PATTERN_LENGTH} chars)`);
  try {
    RE2JS.compile(source);
  } catch {
    throw new UnsafeRegexError("pattern is not a valid regular expression");
  }
}

/** Is `source` a valid, compilable RE2 pattern within the length cap? (non-throwing). */
export function isSafePattern(source: string): boolean {
  try {
    assertSafePattern(source);
    return true;
  } catch {
    return false;
  }
}

/** Does `value` contain a match of `source`? Search semantics (like `RegExp.test`), linear-time.
 *  An unsafe/invalid pattern never matches (returns false) rather than throwing. Case-sensitive. */
export function patternMatches(source: string, value: string): boolean {
  if (!isSafePattern(source)) return false;
  return RE2JS.compile(source).matcher(value).find();
}

/** Case-insensitive "does `value` match `source`?" for search boxes. Unsafe/invalid ⇒ false, no throw. */
export function safeSearch(source: string, value: string): boolean {
  if (!isSafePattern(source)) return false;
  return RE2JS.compile(source, RE2JS.CASE_INSENSITIVE).matcher(value).find();
}
