/**
 * Numeric coercion + rounding — the ONE shared home for the "read a possibly-dirty number off an
 * untrusted read model and don't let a string/null/NaN/±Infinity poison a sum" idiom. This was
 * hand-redefined in ~15 files across all three packages (every roll-up, every money fold); collapse them
 * here so the coercion rule is stated once. Pure, dependency-free.
 */

/** Coerce a possibly-dirty unknown to a finite number, else 0 (string/null/undefined/NaN/±Infinity → 0). */
export const numLoose = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Coerce a typed optional number to a finite number, else 0 — the strict-typed sibling of {@link numLoose}. */
export const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A finite number from a possibly-dirty field, or null when it is absent / blank / non-numeric. */
export const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Round to 2 decimal places (money / percentages). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Round to 1 decimal place (utilisation / health / flow percentages). */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Clamp `n` to the inclusive range [lo, hi]. */
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The finite values from a list (drops null/undefined/NaN/±Infinity) — the input to a safe mean. */
export const finiteValues = (values: readonly (number | null | undefined)[]): number[] =>
  values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

/** Mean of the finite values, or 0 when there are none — the divide-by-zero-safe average. */
export const finiteAvg = (values: readonly (number | null | undefined)[]): number => {
  const finite = finiteValues(values);
  return finite.length ? finite.reduce((s, n) => s + n, 0) / finite.length : 0;
};
