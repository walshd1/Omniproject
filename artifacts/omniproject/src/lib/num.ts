/** Coerce to a finite number, defaulting to 0 for null/undefined/NaN/±Infinity. The one shared
 *  home for this idiom — the pure, derive-only finance roll-ups (capex, benefits, income,
 *  financial-summary, capacity-actuals) each read optional numeric fields off backend items and
 *  need a zero-safe fallback before summing, so this used to be hand-copied into every file. */
export const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
