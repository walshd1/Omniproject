/**
 * The ONE place we turn a (usually admin-supplied) pattern string into a RegExp. Centralised so every
 * regex use — field-validation rules today, UI/record search next — shares the same guards instead of
 * scattering bare `new RegExp(...)`. The client mirrors this module (artifacts/omniproject/src/lib/
 * safe-regex.ts); keep the two in step.
 *
 * Guards (defence-in-depth — patterns are admin-authored, not an anonymous-input trust boundary):
 *   · a hard LENGTH cap, and
 *   · a conservative NESTED-QUANTIFIER check for the classic catastrophic-backtracking shape — a
 *     quantified group that itself contains a quantifier, e.g. `(a+)+`, `(.*)*`, `(a|aa)+`.
 * Compilation is the final validity check. We deliberately do NOT hand-roll structured matching (date
 * ranges, number bounds) as regex — those use typed validators (`lib/validate`).
 */

export const MAX_PATTERN_LENGTH = 200;

export class UnsafeRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRegexError";
  }
}

/** A parenthesised group that both contains a quantifier and is itself quantified — the canonical
 *  ReDoS shape. A single quantified char-class/atom (e.g. `[a-z]+`, `\d*`) is linear and NOT flagged. */
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*]/;

/** Throw {@link UnsafeRegexError} if `source` is over-long, structurally risky, or not a valid regex. */
export function assertSafePattern(source: string): void {
  if (typeof source !== "string") throw new UnsafeRegexError("pattern must be a string");
  if (source.length > MAX_PATTERN_LENGTH) throw new UnsafeRegexError(`pattern too long (max ${MAX_PATTERN_LENGTH} chars)`);
  if (NESTED_QUANTIFIER.test(source)) throw new UnsafeRegexError("pattern has nested quantifiers that risk catastrophic backtracking");
  try {
    new RegExp(source);
  } catch {
    throw new UnsafeRegexError("pattern is not a valid regular expression");
  }
}

/** Is `source` safe to compile? (non-throwing form of {@link assertSafePattern}). */
export function isSafePattern(source: string): boolean {
  try {
    assertSafePattern(source);
    return true;
  } catch {
    return false;
  }
}

/** Compile a guarded RegExp. Throws {@link UnsafeRegexError} on an unsafe/invalid pattern. */
export function compileSafe(source: string, flags?: string): RegExp {
  assertSafePattern(source);
  return flags === undefined ? new RegExp(source) : new RegExp(source, flags);
}

/** Case-insensitive "does `value` match `source`?" for search-style use. An unsafe/invalid pattern
 *  never matches (returns false) rather than throwing — a bad search box shouldn't 500 a list. */
export function safeSearch(source: string, value: string): boolean {
  if (!isSafePattern(source)) return false;
  return compileSafe(source, "i").test(value);
}
