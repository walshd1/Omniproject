import type { Role } from "./rbac";
import { registerAutonomousActor, unregisterAutonomousActor, mintAutonomousContext } from "./autonomous";
import { registerAutonomousGrant, revokeAutonomousGrant, previewAutonomousWrite, type AutonomousWriteGrant } from "./autonomous-grant";
import { effectsForAutonomousContext } from "./workflow-run";
import { runWorkflow, type WorkflowDef, type WorkflowEffect } from "./workflow";
import { compileRecipe } from "./automation";
import { getActionDef, type AutomationRecipe } from "@workspace/backend-catalogue";
import { BatchPlanError, type AgenticBatchPlan } from "./agentic-batch";

/**
 * Supervised agentic execution (D1) — the EXECUTION half (approve-the-batch), JUST-IN-TIME authority model.
 *
 * There is NO standing write authority for the AI. When a human approves a batch, this mints — for that ONE
 * run — a per-batch autonomous principal AND a write grant scoped to EXACTLY the approved plan (the low-risk
 * work-item write `update_issue`, only the plan's projects, `maxWrites` = the plan's write count, a short
 * expiry), runs the batch through the SAME grant-gated substrate a mutating rule uses (mirrors
 * `runRecipeAutonomously`), then TEARS DOWN both the grant and the actor in a `finally`. So the approval IS
 * the grant: nothing the AI can write outlives the run a human authorized, and default-deny holds at every
 * other moment.
 *
 * Containment: the JIT grant is narrow (specific actions + projects, never a wildcard), so it satisfies
 * `off`/`local` AI containment without `allowBroad`. A public/SaaS AI provider (strictest containment)
 * intentionally cannot drive issue mutations here — that's the safe direction to fail for a supervised agent.
 */

/** Least privilege — a batch can never mint above contributor, and a write still needs its JIT grant. */
const BATCH_ACTOR_ROLE: Role = "contributor";

/** The autonomous write action a low-risk edit classifies as at the broker seam (`writeIssue`, op `update`).
 *  The JIT grant admits exactly this. */
export const BATCH_WRITE_ACTION = "update_issue";

/** How long a JIT grant lives — a batch is a bounded, human-supervised run, not a standing capability. */
export const BATCH_GRANT_TTL_MS = 5 * 60 * 1000;

/** The per-batch autonomous actor id (grant is keyed on this via `actorIdOf`, which splits the principal on
 *  ':'). A batch id must therefore be colon-free; enforced here. */
export function batchActorId(batchId: string): string {
  if (!batchId || batchId.includes(":")) throw new BatchPlanError("batch id must be non-empty and contain no ':'");
  return `batch_${batchId}`;
}

/** The approval action a supervised batch binds to. NOT a `workflow.run:` action, so the approval-service
 *  AI-approver carve-out never applies — only a HUMAN can approve a batch. */
export function batchRunAction(batchId: string): string { return `agentic.batch:${batchId}`; }

/** The distinct project ids a plan's MUTATING actions target (from each action's params, else the batch scope). */
function batchProjectIds(plan: AgenticBatchPlan): string[] {
  const ids = new Set<string>();
  for (const a of plan.actions) {
    if (!getActionDef(a.kind)?.mutating) continue;
    const pid = typeof a.params["projectId"] === "string" ? (a.params["projectId"] as string)
      : plan.scope.kind === "project" ? plan.scope.projectId : "";
    if (pid) ids.add(pid);
  }
  return [...ids];
}

/** Build the JUST-IN-TIME write grant for an approved plan: admits ONLY `update_issue`, ONLY the plan's
 *  projects, capped at the plan's write count, expiring shortly. Pure — the caller registers/revokes it. */
export function buildBatchGrant(plan: AgenticBatchPlan, batchId: string, now: number): AutonomousWriteGrant {
  const writes = plan.actions.filter((a) => getActionDef(a.kind)?.mutating).length;
  return {
    actorId: batchActorId(batchId),
    actions: writes ? [BATCH_WRITE_ACTION] : [],
    projects: batchProjectIds(plan),
    maxWrites: writes,
    notAfter: now + BATCH_GRANT_TTL_MS,
  };
}

/** Compile a validated batch into a runnable WorkflowDef, reusing the automation compiler so the
 *  action→effect mapping (and `__op` stamping) can't drift. Actions are pre-validated against the executable
 *  allowlist; each carries its own concrete target in params, so no triggering subject is bound. */
export function compileBatchToWorkflow(plan: AgenticBatchPlan, batchId: string): WorkflowDef {
  const recipeLike = {
    id: `batch:${batchId}`,
    label: `supervised batch ${batchId}`,
    scope: plan.scope,
    trigger: { kind: "issue.created" },
    actions: plan.actions,
  } as unknown as AutomationRecipe;
  return compileRecipe(recipeLike);
}

export interface BatchStepPreview { kind: string; allowed: boolean; reason?: string }

/** Side-effect-free dry-run of the POST-approval state: registers the batch's JIT grant transiently, checks
 *  each write against it, then tears it down — so a human sees exactly what the approval would authorize
 *  (and any step the plan's own grant would still deny). Reads/writes only the in-process grant registry, and
 *  fully restores it before returning. */
export function previewBatch(plan: AgenticBatchPlan, batchId: string, now: number = Date.now()): BatchStepPreview[] {
  const actorId = batchActorId(batchId);
  registerAutonomousActor(actorId, BATCH_ACTOR_ROLE);
  registerAutonomousGrant(buildBatchGrant(plan, batchId, now));
  try {
    const ctx = mintAutonomousContext({ id: actorId, role: BATCH_ACTOR_ROLE, reason: "batch preview" }, now);
    return plan.actions.map((a) => {
      if (!getActionDef(a.kind)?.mutating) return { kind: a.kind, allowed: true }; // inform — no write
      const projectId = typeof a.params["projectId"] === "string" ? (a.params["projectId"] as string)
        : plan.scope.kind === "project" ? plan.scope.projectId : undefined;
      const fields = Object.keys(a.params).filter((k) => k !== "projectId" && k !== "issueId");
      const res = previewAutonomousWrite(ctx, { action: BATCH_WRITE_ACTION, ...(projectId ? { projectId } : {}), fields, now });
      return { kind: a.kind, allowed: res.allowed, ...(res.reason ? { reason: res.reason } : {}) };
    });
  } finally {
    revokeAutonomousGrant(actorId);
    unregisterAutonomousActor(actorId);
  }
}

export interface BatchRunResult { batchId: string; results: Record<string, unknown> }

/** Low-level runner: execute the compiled batch under the per-batch principal, minting a FRESH short-lived
 *  context per write (contexts expire ~30s). Assumes the JIT actor + grant are already registered — call via
 *  {@link runApprovedBatch}, never directly. `onBehalfOf` (the approving human) makes it an attributable
 *  `agent:` principal. */
async function executeBatch(batchId: string, plan: AgenticBatchPlan, onBehalfOf: string, now: () => number): Promise<BatchRunResult> {
  const actorId = batchActorId(batchId);
  const def = compileBatchToWorkflow(plan, batchId);
  const effect: WorkflowEffect = (action, params, runCtx) => {
    const ctx = mintAutonomousContext({ id: actorId, role: BATCH_ACTOR_ROLE, reason: `supervised batch ${batchId}`, onBehalfOf }, now());
    return effectsForAutonomousContext(ctx, ctx.sub ?? actorId)(action, params, runCtx);
  };
  const run = await runWorkflow(def, effect);
  return { batchId, results: run.results };
}

/**
 * Run a batch a human has just approved. Mints the per-batch actor + a JIT grant scoped to EXACTLY this plan,
 * executes, then tears both down in a `finally` (even on error) so no authority outlives the run. INTENDED
 * CALLER: the approval executor, on reaching `approved`. Fails closed — a plan whose writes exceed the JIT
 * grant (e.g. a project the approver couldn't authorize) throws and nothing further is written.
 */
export async function runApprovedBatch(
  batchId: string,
  plan: AgenticBatchPlan,
  opts: { approverSub: string; now?: () => number },
): Promise<BatchRunResult> {
  const actorId = batchActorId(batchId);
  const now = opts.now ?? (() => Date.now());
  registerAutonomousActor(actorId, BATCH_ACTOR_ROLE);
  registerAutonomousGrant(buildBatchGrant(plan, batchId, now()));
  try {
    return await executeBatch(batchId, plan, opts.approverSub, now);
  } finally {
    revokeAutonomousGrant(actorId);
    unregisterAutonomousActor(actorId);
  }
}
