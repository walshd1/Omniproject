/**
 * GOALS / OKRs model — the neutral, primitive-built shape for OmniProject's goal surface (roadmap 3.2). Same
 * architectural principle as proofs (annotation primitives on a proof) and whiteboards (canvas elements on a
 * canvas): a GOAL is a JSON definition — an objective that carries a list of typed KEY-RESULT PRIMITIVES,
 * each a measurable class (number / percent / currency / milestone) with its own value semantics. NOT a
 * bespoke record.
 *
 * The single `KEY_RESULT_KINDS` list is what the authoring palette, the validator AND the unified primitive
 * store (the `keyResult` family, placeable on the `goal` surface) all draw from, so the store can never drift
 * from what a goal can contain. The authoritative sanitiser runs server-side before anything is written.
 */

/**
 * The kinds of key result. `number` — a raw count toward a target; `percent` — a 0–100% attainment;
 * `currency` — a money amount toward a target; `milestone` — a binary deliverable (done ⇒ 100%, else 0%).
 * A key result's attainment maps its `current` between `startValue` and `target`, clamped to 0–100.
 */
export type KeyResultKind = "number" | "percent" | "currency" | "milestone";

/** The key-result primitives, as a value — the single list the palette, validator and primitive store
 *  (`keyResult` family) all draw from, so the family can't drift from the KeyResultKind union. */
export const KEY_RESULT_KINDS: readonly KeyResultKind[] = ["number", "percent", "currency", "milestone"];

/** Kinds whose attainment is BINARY (met ⇒ 100, else 0) rather than a proportional roll toward target. */
export const BINARY_KEY_RESULT_KINDS: readonly KeyResultKind[] = ["milestone"];

/** Whether a key-result kind's attainment is binary (met ⇒ 100, else 0). */
export const isBinaryKeyResultKind = (kind: KeyResultKind): boolean => BINARY_KEY_RESULT_KINDS.includes(kind);

/**
 * Format a key-result value for display by its kind — the primitive's presentational "method", shared by
 * every surface so a `percent` always reads "75%" and a `currency` "$1,000". `milestone` renders done/not.
 * Pure; falls back to the raw number for an unknown kind.
 */
export function formatKeyResultValue(kind: KeyResultKind, value: number, unit?: string): string {
  switch (kind) {
    case "percent":
      return `${value}%`;
    case "currency":
      return `${unit ? unit + " " : ""}${value.toLocaleString()}`;
    case "milestone":
      return value >= 1 ? "Done" : "Not done";
    case "number":
    default:
      return `${value.toLocaleString()}${unit ? " " + unit : ""}`;
  }
}
