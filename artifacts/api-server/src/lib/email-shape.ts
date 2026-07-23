/**
 * Linear (ReDoS-free) email-shape validation.
 *
 * The previous check, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, is polynomial-backtracking (CWE-1333): the domain's
 * two adjacent `[^\s@]+` quantifiers are separated by `\.`, and a literal `.` is itself matched by `[^\s@]`,
 * so on a long input with no valid parse the engine explores O(n^2) split points. Form fields cap at 10k
 * chars, which is far too large to neutralise a quadratic matcher. This replacement scans the string a
 * constant number of times (indexOf / slice / a single non-quantified `\s` class test) — strictly O(n).
 *
 * Accept set equals the old regex — a non-empty local part, exactly one `@`, and a domain with a dot
 * separating two non-empty labels, no whitespace anywhere — MINUS a trailing-dot domain (`x@a.b.`), which
 * is not a valid address and the old pattern only accepted by an accident of backtracking.
 */
export function isEmailShape(s: string): boolean {
  if (/\s/.test(s)) return false; // no whitespace (single non-quantified class ⇒ linear, no backtracking)
  const at = s.indexOf("@");
  if (at <= 0 || s.indexOf("@", at + 1) !== -1) return false; // exactly one `@`, non-empty local part
  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1; // a dot with a non-empty label on each side
}
