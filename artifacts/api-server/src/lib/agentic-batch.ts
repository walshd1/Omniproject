import { getActionDef } from "@workspace/backend-catalogue";
import { isForbiddenKey } from "./safe-json";

/**
 * Supervised agentic execution (D1) — the ACTION-CLASS BOUNDARY.
 *
 * The in-app AI may PLAN a batch of actions; a human approves the batch ONCE (the "approve-the-batch"
 * posture); it then executes under the existing autonomous-write substrate (a minted `agent:` principal, the
 * default-deny grant gate, per-step audit + abort — wired in a later slice). This module is the policy layer:
 * WHICH actions the agent may actually carry out.
 *
 * Operator decision (recorded): the agent may EXECUTE only **inform + low-risk REVERSIBLE edits**. Everything
 * else — creating/closing work items, bulk/structural changes, and anything financial or irreversible — stays
 * PROPOSE-ONLY: the agent may draft it, but a person runs it by hand.
 *
 * This is an ALLOWLIST, not a denylist. An action kind not named here is EXCLUDED by default, so a newly
 * added catalogue action is propose-only until it is deliberately admitted — the safe direction to fail.
 *
 * Pure module: no broker/IO. It classifies + validates a plan; it does NOT authorize. Authorization stays
 * with the autonomous-write grant and the human approval, enforced at execution.
 */

/** Action kinds the supervised agent may EXECUTE (inform + low-risk reversible edits). Keyed to the
 *  automation catalogue: `notify` is inform; the rest are reversible single-field work-item edits. Excluded
 *  on purpose: `create-issue` (structural), `run-depreciation` (financial), and any unlisted/future kind. */
export const AGENTIC_BATCH_ACTIONS: ReadonlySet<string> = new Set([
  "notify",
  "set-field",
  "set-status",
  "assign",
  "add-label",
]);

export type BatchActionClass = "inform" | "low-risk-edit" | "excluded";

/** Classify an action kind against the D1 boundary. An unknown or unlisted kind is "excluded" (safe default);
 *  a listed non-mutating action is "inform"; a listed mutating action is a "low-risk-edit". */
export function classifyBatchAction(kind: string): BatchActionClass {
  if (!AGENTIC_BATCH_ACTIONS.has(kind)) return "excluded";
  return getActionDef(kind)?.mutating ? "low-risk-edit" : "inform";
}

/** Whether the supervised agent may EXECUTE this action (vs only propose it for a human to run). */
export function isBatchExecutable(kind: string): boolean {
  return classifyBatchAction(kind) !== "excluded";
}

/** A supervised batch is a review-ONCE unit, not an unbounded run — cap its size so one approval can't wave
 *  through an arbitrarily long sequence. (The workflow runner also bounds steps at execution.) */
export const MAX_BATCH_ACTIONS = 25;

export class BatchPlanError extends Error {
  constructor(message: string) { super(message); this.name = "BatchPlanError"; }
}

/** One planned action in a batch. */
export interface BatchAction {
  kind: string;
  params: Record<string, unknown>;
}

/** A validated agentic batch plan, ready to enqueue for a single human approval. */
export interface AgenticBatchPlan {
  scope: { kind: "org" } | { kind: "project"; projectId: string };
  actions: BatchAction[];
}

/**
 * Validate a proposed batch (pure). Enforces: scope is org or a specific project; 1..{@link MAX_BATCH_ACTIONS}
 * actions; every action is on the executable allowlist (an excluded/unknown kind is rejected, naming the
 * offender, so the caller can surface it as propose-only); each action's params is a plain object free of
 * prototype-polluting keys. Throws {@link BatchPlanError}. It does NOT authorize — project scope + the
 * autonomous-write grant + the human approval are enforced when the batch executes.
 */
export function validateBatchPlan(raw: unknown): AgenticBatchPlan {
  const o = (raw ?? {}) as Record<string, unknown>;

  const rawScope = (o["scope"] ?? {}) as Record<string, unknown>;
  let scope: AgenticBatchPlan["scope"];
  if (rawScope["kind"] === "org") scope = { kind: "org" };
  else if (rawScope["kind"] === "project" && typeof rawScope["projectId"] === "string" && rawScope["projectId"].trim())
    scope = { kind: "project", projectId: rawScope["projectId"].trim() };
  else throw new BatchPlanError("batch scope must be {kind:'org'} or {kind:'project',projectId}");

  const rawActions = o["actions"];
  if (!Array.isArray(rawActions) || rawActions.length === 0) throw new BatchPlanError("a batch needs at least one action");
  if (rawActions.length > MAX_BATCH_ACTIONS) throw new BatchPlanError(`a batch may hold at most ${MAX_BATCH_ACTIONS} actions`);

  const actions: BatchAction[] = rawActions.map((r, i) => {
    const a = (r ?? {}) as Record<string, unknown>;
    const kind = typeof a["kind"] === "string" ? a["kind"].trim() : "";
    if (!kind) throw new BatchPlanError(`batch action #${i + 1} needs a kind`);
    if (!isBatchExecutable(kind)) throw new BatchPlanError(`action "${kind}" is not executable by the supervised agent — it is propose-only and must be run by a person`);
    const params = a["params"];
    if (params === null || typeof params !== "object" || Array.isArray(params)) throw new BatchPlanError(`batch action "${kind}" needs a params object`);
    for (const k of Object.keys(params as Record<string, unknown>)) {
      if (isForbiddenKey(k)) throw new BatchPlanError(`batch action "${kind}" has a forbidden param key`);
    }
    // Bind each action to the DECLARED scope. The JIT grant's projects are derived from action params, so
    // without this a "project P1" plan could carry actions targeting P2 and the grant would silently admit
    // P2 — the grant could never exceed the plan because it is generated FROM it. Fail closed: an action may
    // not name a project outside a project-scoped batch (an org-scoped batch is intentionally cross-project).
    const pid = (params as Record<string, unknown>)["projectId"];
    if (scope.kind === "project" && typeof pid === "string" && pid.trim() && pid.trim() !== scope.projectId) {
      throw new BatchPlanError(`batch action "${kind}" targets project "${pid.trim()}" outside the declared batch scope "${scope.projectId}"`);
    }
    return { kind, params: params as Record<string, unknown> };
  });

  return { scope, actions };
}
