/**
 * Shared status vocabulary — the single source of truth for "what does this status mean?"
 *
 * OmniProject reads work items from arbitrary brokers, so an item's `status` is free-form: one
 * backend says "done", another "resolved", "shipped" or "live". Membership is therefore matched by
 * SHAPE (word-fragment regex), not an exact enum. The built-in broker's canonical enum
 * (todo / in_progress / in_review / done / cancelled) is a strict subset of what these matchers
 * accept, so on canonical data every helper here agrees with an exact `=== "done"` comparison —
 * which is why methodology views (canonical-only) and reports (any backend) can share them without
 * changing behaviour.
 *
 * Before this module the same predicates were re-implemented, subtly differently, in
 * methodology.ts and five report files — a "resolved" item counted as done in one view and not
 * another. Anything genuinely report-specific (DemandIntake's intake funnel, StrategyAlignment's
 * benefit vocabulary) stays in that report; only the shared primitives live here.
 */

const norm = (s?: string | null): string => (s ?? "").toLowerCase().trim();

/**
 * A status reads as delivered / closed. Note "deliver" is deliberately NOT here: some funnels
 * (e.g. DemandIntake) treat "delivering"/"in delivery" as in-flight work, not completed — those
 * views keep that nuance locally rather than have this primitive over-claim.
 */
export function isDone(status?: string | null): boolean {
  return /done|closed|complete|completed|resolved|shipped|deployed|released|finish|live|accept/.test(norm(status));
}

/** A status reads as cancelled / dropped — terminal, but NOT delivered. */
export function isCancelled(status?: string | null): boolean {
  return /cancel|won.?t|will.?not|abandon|reject|dupl|declin|drop|obsolete/.test(norm(status));
}

/** Terminal = delivered OR cancelled — no further work will happen on the item. */
export function isTerminal(status?: string | null): boolean {
  return isDone(status) || isCancelled(status);
}

/** Coarse lifecycle stage of a free-form status: cancelled wins, then done, then work-in-progress. */
export type Stage = "done" | "wip" | "cancelled" | "other";
export function classifyStage(status?: string | null): Stage {
  const s = norm(status);
  if (!s) return "other";
  if (isCancelled(s)) return "cancelled";
  if (isDone(s)) return "done";
  if (/progress|review|doing|active|develop|testing|qa|build|wip|started/.test(s)) return "wip";
  return "other";
}

export type Rag = "green" | "amber" | "red" | "none";

/**
 * Normalise a free-form RAG / health / benefit status into a bucket (backend vocabulary preserved).
 * Checked green → red → amber; the first match wins, so ambiguous words resolve by that order.
 * The green and red word-sets are the union of the health-report and benefit-report vocabularies
 * (this replaced two same-named `ragBucket` twins that classified "slip"/"realised" differently).
 */
export function ragBucket(status?: string | null): Rag {
  const s = norm(status);
  if (!s) return "none";
  if (/green|on.?track|on.?plan|healthy|complete|good|stable|realis|realiz|achiev|deliver/.test(s)) return "green";
  if (/red|off.?track|critical|blocked|fail|breach|slip|miss|lost|cancel/.test(s)) return "red";
  if (/amber|at.?risk|yellow|warn|delay|concern|risk/.test(s)) return "amber";
  return "none";
}
