/**
 * TASK BULK-OPERATION PLANNER — the pure validation core behind the admin "apply one change to many GTD
 * tasks" endpoint (task-management assessment gap T5). Server-side bulk existed only for projects
 * (`/admin/bulk`); task bulk was a best-effort client fan-out of N single writes, with no dry-run, no
 * no-op detection and no confirm step. This resolves a bulk spec against the selected tasks into a
 * per-task PLAN — the exact change each task will get, or a skip reason (already-closed, no-op, blank
 * target) — plus the summary and a stable, order-independent fingerprint INPUT the route hashes for its
 * secondary-confirmation token.
 *
 * PURE of I/O and Express: it only decides WHAT each write would be; the route runs the plan through the
 * gated broker write path (scope + ruleset + updateTask) per item, exactly as a single PATCH would.
 * Deterministic (no `Date`/`Math.random`, id-sorted), fail-closed (ids coerced to strings, non-object
 * tasks dropped, an invalid spec ⇒ every item skipped, never throws), empty ⇒ empty. Reuses
 * `isTaskStatusClosed` so complete/reopen respect the GTD workflow classes.
 */
import { isTaskStatusClosed } from "./task-vocabulary";

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The declarative bulk verbs. Each composes ONE canonical task write, exactly like a single PATCH. */
export type TaskBulkOp = "complete" | "reopen" | "reassign" | "set_priority" | "set_context" | "move_section";

/** The current state of a selected task (only the fields the ops read, for no-op detection). */
export interface BulkTask {
  id: string;
  status?: string | null;
  assignee?: string | null;
  priority?: string | null;
  context?: string | null;
  section?: string | null;
}

/** The bulk spec: the op + its (op-specific) parameter. */
export interface TaskBulkSpec {
  op: TaskBulkOp;
  /** reassign: the new assignee (non-blank; use an explicit unassign op/route if you need to clear). */
  assignee?: string;
  /** set_priority: the new priority; validated against `validPriorities` when supplied. */
  priority?: string;
  /** set_context: the new GTD context (non-blank). */
  context?: string;
  /** move_section: the new section (non-blank). */
  section?: string;
}

export interface TaskBulkOptions {
  /** The status a `complete` op sets (default "done"). */
  completeStatus?: string;
  /** The status a `reopen` op sets (default "next"). */
  reopenStatus?: string;
  /** Allowed priorities for set_priority; when supplied, an out-of-set value invalidates the spec. */
  validPriorities?: string[];
}

export interface TaskBulkPlanItem {
  id: string;
  /** The resolved change set (a partial task write); empty when skipped. */
  changes: Record<string, unknown>;
  skipped: boolean;
  /** Why the item was skipped (absent when it will apply). */
  reason?: string;
}

export interface TaskBulkPlan {
  op: TaskBulkOp | null;
  /** False when the spec itself is unusable (unknown op / missing or bad parameter) ⇒ every item skipped. */
  valid: boolean;
  /** Why the spec is invalid (absent when valid). */
  reason?: string;
  /** Per-task plan, id-sorted. */
  items: TaskBulkPlanItem[];
  summary: { total: number; willApply: number; willSkip: number };
  /** Stable, order-independent input the route hashes into the confirm token (ids sorted). */
  fingerprintInput: { op: string; ids: string[]; params: Record<string, unknown> };
}

const KNOWN_OPS = new Set<TaskBulkOp>(["complete", "reopen", "reassign", "set_priority", "set_context", "move_section"]);
const nonBlank = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Resolve the op's canonical parameter + the change-builder, or an invalidity reason. */
function resolveSpec(spec: TaskBulkSpec, opts: TaskBulkOptions): { params: Record<string, unknown>; reason?: string } {
  switch (spec.op) {
    case "complete":
      return { params: { status: opts.completeStatus ?? "done" } };
    case "reopen":
      return { params: { status: opts.reopenStatus ?? "next" } };
    case "reassign": {
      const assignee = nonBlank(spec.assignee);
      return assignee ? { params: { assignee } } : { params: {}, reason: "reassign needs a non-blank assignee" };
    }
    case "set_priority": {
      const priority = nonBlank(spec.priority);
      if (!priority) return { params: {}, reason: "set_priority needs a priority" };
      if (opts.validPriorities && !opts.validPriorities.includes(priority)) return { params: {}, reason: `priority "${priority}" is not a known priority` };
      return { params: { priority } };
    }
    case "set_context": {
      const context = nonBlank(spec.context);
      return context ? { params: { context } } : { params: {}, reason: "set_context needs a non-blank context" };
    }
    case "move_section": {
      const section = nonBlank(spec.section);
      return section ? { params: { section } } : { params: {}, reason: "move_section needs a non-blank section" };
    }
    default:
      return { params: {}, reason: `unknown bulk op "${String(spec.op)}"` };
  }
}

/** The per-task no-op / precondition check for a resolved op. Returns a skip reason, or null to apply. */
function skipReason(op: TaskBulkOp, task: BulkTask, params: Record<string, unknown>): string | null {
  switch (op) {
    case "complete":
      return isTaskStatusClosed(task.status) ? "already closed" : null;
    case "reopen":
      return isTaskStatusClosed(task.status) ? null : "not closed";
    case "reassign":
      return (task.assignee ?? "") === params["assignee"] ? "already assigned to that person" : null;
    case "set_priority":
      return (task.priority ?? "") === params["priority"] ? "already at that priority" : null;
    case "set_context":
      return (task.context ?? "") === params["context"] ? "already in that context" : null;
    case "move_section":
      return (task.section ?? "") === params["section"] ? "already in that section" : null;
    default:
      return "unknown op";
  }
}

/**
 * Plan a bulk operation over the selected tasks. Empty selection ⇒ empty plan; an invalid spec ⇒ every item
 * skipped with `valid:false`. No I/O; the route applies the resulting changes through the gated write path.
 */
export function planTaskBulk(tasks: readonly BulkTask[], spec: TaskBulkSpec, options: TaskBulkOptions = {}): TaskBulkPlan {
  const op = spec && KNOWN_OPS.has(spec.op) ? spec.op : null;
  const clean = (Array.isArray(tasks) ? tasks : [])
    .filter((t): t is BulkTask => t !== null && typeof t === "object")
    .map((t) => ({ ...t, id: String(t.id ?? "") }))
    .filter((t) => t.id !== "")
    .sort((a, b) => byStr(a.id, b.id));

  const resolved = op ? resolveSpec(spec, options) : { params: {}, reason: `unknown bulk op "${String(spec?.op)}"` };
  const valid = op !== null && resolved.reason === undefined;

  const items: TaskBulkPlanItem[] = clean.map((task) => {
    if (!valid) return { id: task.id, changes: {}, skipped: true, reason: resolved.reason ?? "invalid spec" };
    const skip = skipReason(op!, task, resolved.params);
    return skip ? { id: task.id, changes: {}, skipped: true, reason: skip } : { id: task.id, changes: { ...resolved.params }, skipped: false };
  });

  const willApply = items.filter((i) => !i.skipped).length;
  return {
    op,
    valid,
    ...(valid ? {} : { reason: resolved.reason ?? `unknown bulk op "${String(spec?.op)}"` }),
    items,
    summary: { total: items.length, willApply, willSkip: items.length - willApply },
    fingerprintInput: { op: op ?? "", ids: clean.map((t) => t.id), params: valid ? resolved.params : {} },
  };
}
