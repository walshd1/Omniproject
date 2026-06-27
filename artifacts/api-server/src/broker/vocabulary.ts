/**
 * Canonical value vocabularies — the cross-backend meanings the gateway reasons
 * about (status lifecycle, priority, RAG), defined ONCE so no neutral module
 * hard-codes "done" or GREEN/AMBER/RED. Backends keep their own values verbatim
 * on the wire (Issue.status stays an open string); these are the canonical tokens
 * the gateway's roll-up and health maths classify INTO — plus the typed,
 * data-driven mapping a broker uses to translate a vendor's dialect BELOW the
 * seam, instead of branching on vendor names in code.
 */

// ── Status ───────────────────────────────────────────────────────────────────

/** Canonical work-item statuses a backend's native value normalises into. */
export const CANONICAL_STATUS = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUS)[number];

/** The lifecycle class a status falls in — what the completion maths key off. */
export type StatusClass = "open" | "active" | "done" | "cancelled";

/** Canonical status → lifecycle class. */
export const STATUS_CLASS: Record<CanonicalStatus, StatusClass> = {
  backlog: "open",
  todo: "open",
  in_progress: "active",
  in_review: "active",
  done: "done",
  cancelled: "cancelled",
};

// Common native synonyms seen across backends, folded onto a canonical status so
// completion detection works without a per-backend mapping. A backend can still
// declare an explicit StatusVocabulary (below) to override these.
const STATUS_SYNONYMS: Record<string, CanonicalStatus> = {
  done: "done", closed: "done", complete: "done", completed: "done", resolved: "done", fixed: "done",
  cancelled: "cancelled", canceled: "cancelled", wontfix: "cancelled", rejected: "cancelled", "won't do": "cancelled",
  in_progress: "in_progress", "in progress": "in_progress", inprogress: "in_progress", doing: "in_progress", started: "in_progress",
  in_review: "in_review", "in review": "in_review", inreview: "in_review", review: "in_review",
  todo: "todo", "to do": "todo", open: "todo", new: "todo",
  backlog: "backlog",
};

/** A backend's declared status dialect: native value ⇄ canonical (data, not code). */
export interface StatusVocabulary {
  /** Native status (lower-cased) → canonical status. */
  toCanonical: Record<string, CanonicalStatus>;
  /** Canonical status → the native value to send on write. */
  fromCanonical?: Partial<Record<CanonicalStatus, string>>;
}

/**
 * Resolve a native status to a canonical one: a backend's declared vocabulary
 * wins, then the shared synonyms, then null. Pure + data-driven — this is how a
 * vendor's status dialect is abstracted below the seam.
 */
export function normaliseStatus(native: string | null | undefined, vocab?: StatusVocabulary): CanonicalStatus | null {
  if (!native) return null;
  const key = native.trim().toLowerCase();
  return vocab?.toCanonical[key] ?? STATUS_SYNONYMS[key] ?? null;
}

/** The lifecycle class of a native status; "open" when it can't be classified. */
export function statusClassOf(native: string | null | undefined, vocab?: StatusVocabulary): StatusClass {
  const canonical = normaliseStatus(native, vocab);
  return canonical ? STATUS_CLASS[canonical] : "open";
}

/** True when a native status means the work is finished (the completion test). */
export function isDone(native: string | null | undefined, vocab?: StatusVocabulary): boolean {
  return statusClassOf(native, vocab) === "done";
}

/** True when a status is terminal (done OR cancelled) — e.g. excluded from "overdue". */
export function isClosed(native: string | null | undefined, vocab?: StatusVocabulary): boolean {
  const cls = statusClassOf(native, vocab);
  return cls === "done" || cls === "cancelled";
}

// ── Priority ─────────────────────────────────────────────────────────────────

/** Canonical work-item priorities, lowest → highest. */
export const CANONICAL_PRIORITY = ["none", "low", "medium", "high", "urgent"] as const;
export type CanonicalPriority = (typeof CANONICAL_PRIORITY)[number];

// ── RAG (red/amber/green) ────────────────────────────────────────────────────

/** Canonical RAG reporting statuses. */
export const RAG_STATUSES = ["GREEN", "AMBER", "RED"] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];

/** RAG from a completion percentage (≥60 green, ≥25 amber, else red). */
export function ragFor(completionPct: number): RagStatus {
  if (completionPct >= 60) return "GREEN";
  if (completionPct >= 25) return "AMBER";
  return "RED";
}

/** RAG from cost performance: prefer CPI when earned value is known, else the spend ratio. */
export function financialHealthFrom(cpi: number | null, budget: number, actualCost: number): RagStatus {
  if (cpi !== null) return cpi < 0.9 ? "RED" : cpi < 1 ? "AMBER" : "GREEN";
  if (budget <= 0) return "GREEN";
  const ratio = actualCost / budget;
  return ratio > 1 ? "RED" : ratio >= 0.9 ? "AMBER" : "GREEN";
}

/** A zeroed RAG tally (e.g. for the Prometheus portfolio gauge). */
export function ragBuckets(): Record<RagStatus, number> {
  return { GREEN: 0, AMBER: 0, RED: 0 };
}
