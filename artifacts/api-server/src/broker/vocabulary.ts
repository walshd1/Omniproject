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
// from a helpdesk or a project). Its lifecycle is the GTD workflow, not the issue board.

/** Canonical GTD task states a backend's native task status normalises into.
 *  next = actionable now · waiting = delegated/blocked on someone · scheduled = deferred to a time ·
 *  someday = someday/maybe (incubating) · done · dropped (decided not to do). */
export const CANONICAL_TASK_STATUS = ["next", "waiting", "scheduled", "someday", "done", "dropped"] as const;
export type CanonicalTaskStatus = (typeof CANONICAL_TASK_STATUS)[number];

/** The workflow class a task status falls in. */
export type TaskStatusClass = "actionable" | "waiting" | "deferred" | "done" | "dropped";

/** Canonical task status → workflow class. */
export const TASK_STATUS_CLASS: Record<CanonicalTaskStatus, TaskStatusClass> = {
  next: "actionable",
  waiting: "waiting",
  scheduled: "deferred",
  someday: "deferred",
  done: "done",
  dropped: "dropped",
};

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
