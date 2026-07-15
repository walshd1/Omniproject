import type { Request } from "express";
import { getBroker, contextFromReq, type Broker, type ActorContext } from "../broker";
import { getNotifyBus } from "./notify-bus";
import { getSettings } from "./settings";
import { registerApprovalExecutor } from "./approval-service";
import { runWorkflow, type WorkflowEffect, type WorkflowRunContext, type WorkflowDef } from "./workflow";

/**
 * Runtime side of workflows — binds the pure engine's injected effect to the REAL, RBAC-scoped surfaces
 * below the seam, and runs a stored workflow. The effect is a strict ALLOWLIST (fail-closed): read the
 * broker (with the caller's scope) and post a notification. A mutating/unknown action is REFUSED here —
 * a broker WRITE from a workflow is an autonomous action that must go through an approval-gated step +
 * autonomous grant, never a plain effect. So a workflow can observe + inform, but can't silently mutate.
 *
 * Two entry points differ only in WHERE the scope comes from:
 *   - {@link scopedEffects} — a live request (the caller's session context). The direct-run path.
 *   - {@link effectsForActor} — a captured actor snapshot. The approval-gated path: when a chain finally
 *     approves a bound run, the executor runs the workflow under the PROPOSER's recorded identity (the
 *     signed approval IS the authorization). No live session exists at that point.
 */

export class WorkflowRunError extends Error {
  constructor(message: string) { super(message); this.name = "WorkflowRunError"; }
}

export interface EffectDeps {
  broker: Broker;
  ctx: ActorContext;
  /** Post a notification to a target (sub/email). Injected so the effect is unit-testable. */
  notify: (n: { kind: string; title: string; body: string }, target: { sub?: string; email?: string }) => void;
  /** The workflow's owner (notifications default to them). */
  owner: string;
}

/** Build the effect surface from injected deps. Pure allowlist — no action outside it can run. */
export function makeEffects(deps: EffectDeps): WorkflowEffect {
  return async (action, params, _ctx: WorkflowRunContext): Promise<unknown> => {
    switch (action) {
      case "broker.listProjects": return deps.broker.listProjects(deps.ctx);
      case "broker.listIssues": return deps.broker.listIssues(deps.ctx, String(params["projectId"] ?? ""));
      case "broker.projectSummary": return deps.broker.projectSummary(deps.ctx, String(params["projectId"] ?? ""));
      case "broker.portfolioHealth": return deps.broker.portfolioHealth(deps.ctx);
      case "broker.notifications": return deps.broker.notifications(deps.ctx);
      case "notify": {
        deps.notify(
          { kind: String(params["kind"] ?? "workflow"), title: String(params["title"] ?? "Workflow"), body: String(params["body"] ?? "") },
          { sub: params["sub"] ? String(params["sub"]) : deps.owner, ...(params["email"] ? { email: String(params["email"]) } : {}) },
        );
        return { sent: true };
      }
      default:
        throw new WorkflowRunError(`action "${action}" is not permitted in a workflow (reads + notify only; a mutation needs an approval-gated step)`);
    }
  };
}

/** Publish a workflow notification to the shared bus (the same fan-out both entry points use). */
function busNotify(n: { kind: string; title: string; body: string }, target: { sub?: string; email?: string }): void {
  void getNotifyBus().publish({
    notification: { id: `wf-${n.title}-${Date.now()}`, kind: n.kind, title: n.title, body: n.body, read: false, timestamp: Date.now() },
    target,
  });
}

/** The RBAC-scoped effect surface for a real request (the caller's broker context). */
export function scopedEffects(req: Request, owner: string): WorkflowEffect {
  return makeEffects({ broker: getBroker(), ctx: contextFromReq(req), owner, notify: busNotify });
}

/** A captured actor identity — enough to rebuild the broker context after the request has gone (the
 *  approval-gated path). Carries no session cookie / passkey material, only the forwarded identity. */
export interface RunActor {
  sub: string;
  email?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  scope?: ActorContext["scope"];
}

/** Build a broker context from a recorded actor. No `sessionBind` ⇒ falls back to the static broker key,
 *  which is the documented behaviour for a system-authorized (non-session) call. */
function ctxFromActor(a: RunActor): ActorContext {
  return { sub: a.sub, email: a.email, name: a.name, role: a.role, scope: a.scope, actorKind: "human" };
}

/** The effect surface for a recorded actor (the approval-gated executor path). */
export function effectsForActor(a: RunActor, owner: string): WorkflowEffect {
  return makeEffects({ broker: getBroker(), ctx: ctxFromActor(a), owner, notify: busNotify });
}

/** Run a stored workflow by id with the caller's live request scope. Throws when unknown. */
export async function runStoredWorkflow(req: Request, id: string, owner: string): Promise<WorkflowRunContext> {
  const def = loadWorkflow(id);
  return runWorkflow(def, scopedEffects(req, owner));
}

/** Run a stored workflow under a recorded actor (used by the approval executor). Throws when unknown. */
export async function runStoredWorkflowForActor(id: string, owner: string, actor: RunActor): Promise<WorkflowRunContext> {
  const def = loadWorkflow(id);
  return runWorkflow(def, effectsForActor(actor, owner));
}

function loadWorkflow(id: string): WorkflowDef {
  const def: WorkflowDef | undefined = getSettings().workflows.find((w) => w.id === id);
  if (!def) throw new WorkflowRunError(`unknown workflow "${id}"`);
  return def;
}

/** The approval action a specific workflow's RUN binds to — per-id, so an admin can gate ONE sensitive
 *  workflow while leaving benign ones on the direct path. Bind it in settings.approvalBindings. */
export function workflowRunAction(id: string): string { return `workflow.run:${id}`; }

/** Ensure the executor for a workflow-run action is registered (idempotent). Called before a bound run is
 *  proposed, so that when the chain approves, the run actually fires under the proposer's recorded actor. */
export function ensureWorkflowExecutor(id: string): void {
  registerApprovalExecutor(workflowRunAction(id), async (params) => {
    const p = (params ?? {}) as { id?: string; owner?: string; actor?: RunActor };
    if (!p.id || !p.actor?.sub) throw new WorkflowRunError("workflow-run proposal is missing its id/actor");
    await runStoredWorkflowForActor(p.id, p.owner ?? p.actor.sub, p.actor);
  });
}
