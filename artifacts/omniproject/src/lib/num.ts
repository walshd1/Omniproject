/** Coerce to a finite number, defaulting to 0 for null/undefined/NaN/±Infinity. The one shared
 *  home for this idiom — the pure, derive-only finance roll-ups (capex, benefits, income,
 *  financial-summary, capacity-actuals) each read optional numeric fields off backend items and
 *  need a zero-safe fallback before summing, so this used to be hand-copied into every file. */
export const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Same coercion as `num`, but also accepts a possibly-dirty (e.g. stringly-typed) unknown value —
 *  for roll-ups that read fields off less-trusted read models (string, null, NaN, Infinity all coerce to 0). */
export const numLoose = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Round to 2 decimal places — the shared home for the money/percentage roll-ups that each used to
 *  re-declare `Math.round(n * 100) / 100` locally (portfolio-value, portfolio-finance, benefits, custom-report). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
