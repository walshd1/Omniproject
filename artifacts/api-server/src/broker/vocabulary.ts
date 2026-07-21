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

// The canonical status list + lifecycle class are shared reference data, sourced from the
// backend-catalogue work-vocabulary asset (assets/work-vocabulary.json) so the gateway and the SPA
// can't drift on WHICH statuses exist. Re-exported here so this module stays the gateway's single
// import surface for status vocabulary; the native⇄canonical synonym/dialect behaviour below stays
// above the seam.
import { CANONICAL_STATUS, STATUS_CLASS, canonicalStatusOf, type CanonicalStatus, type StatusClass } from "@workspace/backend-catalogue";
export { CANONICAL_STATUS, STATUS_CLASS, canonicalStatusOf, type CanonicalStatus, type StatusClass };

// The canonical GTD task states + their workflow class are likewise shared reference data, sourced from the
// backend-catalogue task-vocabulary asset (assets/task-vocabulary.json) — mirroring the work-item status axis
// above — so the gateway and the SPA can't drift on WHICH task statuses exist. Re-exported here so this module
// stays the gateway's single import surface for task vocabulary; the native⇄canonical synonym behaviour below
// stays above the seam.
import { CANONICAL_TASK_STATUS, TASK_STATUS_CLASS, type CanonicalTaskStatus, type TaskStatusClass } from "@workspace/backend-catalogue";
export { CANONICAL_TASK_STATUS, TASK_STATUS_CLASS, type CanonicalTaskStatus, type TaskStatusClass };

// The canonical GTD ENERGY levels + their ordinal level are likewise shared reference data, sourced from the
// backend-catalogue energy-vocabulary asset (assets/energy-vocabulary.json) — mirroring the task-status axis
// above — so the gateway and the SPA can't drift on WHICH energy levels exist. Re-exported here so this module
// stays the gateway's single import surface for energy vocabulary.
import { CANONICAL_ENERGY, ENERGY_LEVEL, type CanonicalEnergy } from "@workspace/backend-catalogue";
export { CANONICAL_ENERGY, ENERGY_LEVEL, type CanonicalEnergy };

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
 * Resolve a native status to a canonical one. Precedence: a backend's declared vocabulary wins; then an
 * ADJUSTABLE status we defined ourselves (its `canonical` binding — so a custom/methodology status like a
 * GTD "next" classifies onto its internal lifecycle anchor); then the shared cross-vendor synonyms; then
 * null. Pure + data-driven — this is how any status (vendor-native OR our own adjustable one) is tied to
 * the internal lifecycle the gateway reasons about.
 */
export function normaliseStatus(native: string | null | undefined, vocab?: StatusVocabulary): CanonicalStatus | null {
  if (!native) return null;
  const key = native.trim().toLowerCase();
  return vocab?.toCanonical[key] ?? canonicalStatusOf(native) ?? canonicalStatusOf(key) ?? STATUS_SYNONYMS[key] ?? null;
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

// ── Project lifecycle ────────────────────────────────────────────────────────
// A PROJECT's lifecycle is distinct from an issue's status: a project is LIVE (still being delivered)
// or CLOSED (completed / archived / cancelled). This is the axis reads default-filter on so a backend's
// archived projects don't silently inflate portfolio, programme and financial roll-ups.

/** Canonical project lifecycle states a backend's native project status normalises into. */
export const CANONICAL_PROJECT_STATUS = ["active", "on_hold", "completed", "archived", "cancelled"] as const;
export type CanonicalProjectStatus = (typeof CANONICAL_PROJECT_STATUS)[number];

/** Whether a project is still being delivered (live) or finished/shelved/dropped (closed). */
export type ProjectLifecycleClass = "live" | "closed";

/** Canonical project status → lifecycle class. `active`/`on_hold` are live; the rest are closed. */
export const PROJECT_STATUS_CLASS: Record<CanonicalProjectStatus, ProjectLifecycleClass> = {
  active: "live",
  on_hold: "live",
  completed: "closed",
  archived: "closed",
  cancelled: "closed",
};

// Native synonyms seen across backends, folded onto a canonical project status.
const PROJECT_STATUS_SYNONYMS: Record<string, CanonicalProjectStatus> = {
  active: "active", open: "active", "in progress": "active", in_progress: "active", live: "active", ongoing: "active", current: "active",
  on_hold: "on_hold", "on hold": "on_hold", hold: "on_hold", paused: "on_hold", suspended: "on_hold",
  completed: "completed", complete: "completed", done: "completed", finished: "completed", closed: "completed", delivered: "completed",
  archived: "archived", archive: "archived", inactive: "archived",
  cancelled: "cancelled", canceled: "cancelled", abandoned: "cancelled", dropped: "cancelled", terminated: "cancelled",
};

/** Resolve a native project status to a canonical one (via synonyms), or null if unclassifiable. */
export function normaliseProjectStatus(native: string | null | undefined): CanonicalProjectStatus | null {
  if (!native) return null;
  return PROJECT_STATUS_SYNONYMS[native.trim().toLowerCase()] ?? null;
}

/**
 * Is a project LIVE (still active)? A project with NO status — or one whose status can't be classified —
 * is treated as LIVE: we never hide a project just because its lifecycle is unknown (default-safe). Only
 * an explicit closed status (completed / archived / cancelled) is filtered out.
 */
export function isProjectLive(native: string | null | undefined): boolean {
  const canon = normaliseProjectStatus(native);
  return canon === null || PROJECT_STATUS_CLASS[canon] === "live";
}

// ── Task lifecycle (GTD) ─────────────────────────────────────────────────────
// A TASK is an ACTIONABLE next-action (David Allen's GTD), distinct from an ISSUE (a problem/blocker
// from a helpdesk or a project). Its lifecycle is the GTD workflow, not the issue board. The canonical
// GTD states + their workflow class (CANONICAL_TASK_STATUS / TASK_STATUS_CLASS) are sourced from the
// backend-catalogue task-vocabulary asset and re-exported at the top of this module (like the issue axis);
// the native⇄canonical synonym folding below is the above-the-seam dialect behaviour.

// Native synonyms across tools, folded onto a canonical GTD status.
const TASK_STATUS_SYNONYMS: Record<string, CanonicalTaskStatus> = {
  next: "next", "next action": "next", "next_action": "next", todo: "next", "to do": "next", actionable: "next", active: "next", doing: "next", "in progress": "next", in_progress: "next", started: "next",
  waiting: "waiting", "waiting for": "waiting", waiting_for: "waiting", waitingon: "waiting", blocked: "waiting", delegated: "waiting", "on hold": "waiting",
  scheduled: "scheduled", calendar: "scheduled", deferred: "scheduled", snoozed: "scheduled", tickler: "scheduled",
  someday: "someday", "someday/maybe": "someday", "someday maybe": "someday", maybe: "someday", incubate: "someday", incubating: "someday", backlog: "someday",
  done: "done", complete: "done", completed: "done", finished: "done", closed: "done",
  dropped: "dropped", cancelled: "dropped", canceled: "dropped", abandoned: "dropped", wontdo: "dropped", "won't do": "dropped", trashed: "dropped",
};

/** Resolve a native task status to a canonical GTD one (via synonyms), or null if unclassifiable. */
export function normaliseTaskStatus(native: string | null | undefined): CanonicalTaskStatus | null {
  if (!native) return null;
  return TASK_STATUS_SYNONYMS[native.trim().toLowerCase()] ?? null;
}

/** Is this task an ACTIONABLE next-action right now? (the GTD "what can I do next" filter). A task with
 *  no/unknown status defaults to actionable — an uncategorised captured task is a candidate next-action. */
export function isActionable(native: string | null | undefined): boolean {
  const canon = normaliseTaskStatus(native);
  return canon === null || TASK_STATUS_CLASS[canon] === "actionable";
}

/** Is a task finished OR dropped (terminal)? — e.g. excluded from an active GTD list. */
export function isTaskClosed(native: string | null | undefined): boolean {
  const canon = normaliseTaskStatus(native);
  if (!canon) return false;
  const cls = TASK_STATUS_CLASS[canon];
  return cls === "done" || cls === "dropped";
}

/** Is a task COMPLETED (done), as distinct from dropped? — e.g. the trigger to spawn a recurring task's next
 *  occurrence (dropping one should NOT recur). Keeps the "done" meaning inside vocabulary. */
export function isTaskDone(native: string | null | undefined): boolean {
  const canon = normaliseTaskStatus(native);
  return !!canon && TASK_STATUS_CLASS[canon] === "done";
}

// ── Priority ─────────────────────────────────────────────────────────────────

/** Canonical work-item priorities, lowest → highest. */
export const CANONICAL_PRIORITY = ["none", "low", "medium", "high", "urgent"] as const;
export type CanonicalPriority = (typeof CANONICAL_PRIORITY)[number];

// (GTD energy levels are re-exported near the top of this module — sourced from the energy-vocabulary asset.)

// ── RAG (red/amber/green) ────────────────────────────────────────────────────

/** Canonical RAG reporting statuses. */
export const RAG_STATUSES = ["GREEN", "AMBER", "RED"] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];

/** Normalise a free-form RAG value (any case / surrounding whitespace) to a canonical RagStatus, or
 *  null when it isn't one of the three — the SINGLE classification action behind every RAG tally,
 *  replacing the hand-rolled `s === "red" … else` ladders each roll-up used to inline. */
export function classifyRag(value: unknown): RagStatus | null {
  const s = String(value ?? "").trim().toUpperCase();
  return s === "GREEN" || s === "AMBER" || s === "RED" ? (s as RagStatus) : null;
}

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
