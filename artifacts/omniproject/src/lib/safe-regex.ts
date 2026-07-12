/**
 * Client mirror of the server's lib/safe-regex.ts — the ONE place the SPA turns a pattern string into
 * a RegExp, shared by field-validation feedback and (record/UI) search. Keep in step with the server
 * module; the server stays authoritative for enforcement.
 *
 * Guards: a hard length cap and a conservative nested-quantifier check for the classic
 * catastrophic-backtracking shape (`(a+)+`, `(.*)*`). A single quantified char-class/atom is linear
 * and NOT flagged. Structured checks (date ranges, number bounds) are typed, never regex.
 */

export const MAX_PATTERN_LENGTH = 200;

const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*]/;

/** Is `source` safe to compile? */
export function isSafePattern(source: string): boolean {
  if (typeof source !== "string" || source.length > MAX_PATTERN_LENGTH) return false;
  if (NESTED_QUANTIFIER.test(source)) return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** Compile a guarded RegExp, or null when the pattern is unsafe/invalid. */
export function compileSafe(source: string, flags?: string): RegExp | null {
  if (!isSafePattern(source)) return null;
  return flags === undefined ? new RegExp(source) : new RegExp(source, flags);
}

/** Case-insensitive "does `value` match `source`?" for search boxes. An unsafe/invalid pattern never
 *  matches (returns false) rather than throwing. */
export function safeSearch(source: string, value: string): boolean {
  const re = compileSafe(source, "i");
  return re ? re.test(value) : false;
}
