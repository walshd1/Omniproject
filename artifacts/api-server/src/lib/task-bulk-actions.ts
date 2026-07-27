import { createHash } from "node:crypto";
import { evaluateRuleset } from "./ruleset";
import { poolMap } from "./concurrency-pool";
import { planTaskBulk, type BulkTask, type TaskBulkSpec, type TaskBulkOptions, type TaskBulkPlan } from "@workspace/backend-catalogue";
import type { Role } from "./rbac";

/**
 * Task BULK-ACTION runner — the admin "apply one canonical change to many GTD tasks" JOB, separated from the
 * HTTP shell (the /api/tasks/bulk route). The pure `planTaskBulk` (backend-catalogue) validates + resolves
 * the per-task change and skips no-ops; this runs each PLANNED item through the SAME gated write path a
 * single PATCH would: the business ruleset (`evaluateRuleset("update_task")`, restrict-only) per item, then
 * the broker write via the caller's `apply` closure (which routes through the seam's autonomous/scope
 * guards). A blocked/errored item is SKIPPED with its reason (partial success), never forced. The route
 * pre-filters `tasks` to the caller's scope, so only in-scope tasks reach here.
 *
 * Stateless + Express-free. The confirmation fingerprint is a hash of the pure plan's order-independent
 * fingerprint input — the same deliberate-second-step control as project bulk (`bulkFingerprint`).
 */

/** Hard cap on tasks per batch — each item is a broker write, so an unbounded array is a write-amplification DoS. */
export const MAX_TASK_BULK_ITEMS = 500;
/** In-flight item-writes at once — matches the project-bulk fan-out ceiling. */
const TASK_BULK_FANOUT = 10;

/** A stateless confirmation fingerprint over the plan's canonical (order-independent) input. */
export function taskBulkFingerprint(input: TaskBulkPlan["fingerprintInput"]): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type TaskBulkItemStatus = "applied" | "skipped" | "error" | "preview-apply" | "preview-skip";

export interface TaskBulkItemResult {
  id: string;
  status: TaskBulkItemStatus;
  reason?: string;
  /** The business-rule id that blocked it (when skipped by the ruleset). */
  rule?: string;
}

export interface TaskBulkOutcome {
  total: number;
  applied: number;
  skipped: number;
  errored: number;
  results: TaskBulkItemResult[];
  summary: TaskBulkPlan["summary"];
  fingerprint: string;
}

export interface RunTaskBulkInput {
  /** The selected tasks' current state, already scope-filtered by the route. */
  tasks: BulkTask[];
  spec: TaskBulkSpec;
  options?: TaskBulkOptions;
  role: Role;
  /** Preview only — validate + ruleset each item and project the outcome without writing. */
  dryRun: boolean;
  /** Apply one task's resolved change through the gated broker write path; returns the updated task (or null). */
  apply: (id: string, changes: Record<string, unknown>) => Promise<{ id?: string } | null>;
  /** The task's project id (for the ruleset's per-project scope), when known. */
  projectIdOf?: (id: string) => string | null | undefined;
  onItemError?: (id: string, err: unknown) => void;
}

/**
 * Plan + run a task bulk operation, at most {@link TASK_BULK_FANOUT} writes in flight, resolving in plan
 * order. Each item is independent (one skip/error never aborts the batch). Returns the plan's fingerprint so
 * the route can enforce the secondary-confirmation gate.
 */
export async function runTaskBulk(input: RunTaskBulkInput): Promise<TaskBulkOutcome> {
  const plan = planTaskBulk(input.tasks, input.spec, input.options);
  const fingerprint = taskBulkFingerprint(plan.fingerprintInput);

  const results = await poolMap(plan.items, TASK_BULK_FANOUT, async (item): Promise<TaskBulkItemResult> => {
    if (item.skipped) return { id: item.id, status: input.dryRun ? "preview-skip" : "skipped", ...(item.reason ? { reason: item.reason } : {}) };
    const verdict = evaluateRuleset({ action: "update_task", write: true, role: input.role, projectId: input.projectIdOf?.(item.id) ?? null, payload: item.changes });
    if (!verdict.allow) return { id: item.id, status: input.dryRun ? "preview-skip" : "skipped", reason: verdict.blocked!.message, rule: verdict.blocked!.id };
    if (input.dryRun) return { id: item.id, status: "preview-apply" };
    try {
      const updated = await input.apply(item.id, item.changes);
      if (!updated?.id) return { id: item.id, status: "error", reason: "broker returned no task" };
      return { id: item.id, status: "applied" };
    } catch (err) {
      input.onItemError?.(item.id, err);
      return { id: item.id, status: "error", reason: err instanceof Error ? err.message : "broker error" };
    }
  });

  const applied = results.filter((r) => r.status === "applied" || r.status === "preview-apply").length;
  const errored = results.filter((r) => r.status === "error").length;
  return { total: results.length, applied, skipped: results.length - applied - errored, errored, results, summary: plan.summary, fingerprint };
}
