import type { Request } from "express";
import { getBroker, contextFromReq, type Broker, type ActorContext } from "../broker";
import { getNotifyBus } from "./notify-bus";
import { getSettings } from "./settings";
import { runWorkflow, type WorkflowEffect, type WorkflowRunContext, type WorkflowDef } from "./workflow";

/**
 * Runtime side of workflows — binds the pure engine's injected effect to the REAL, RBAC-scoped surfaces
 * below the seam, and runs a stored workflow. The effect is a strict ALLOWLIST (fail-closed): read the
 * broker (with the caller's scope) and post a notification. A mutating/unknown action is REFUSED here —
 * a broker WRITE from a workflow is an autonomous action that must go through an approval-gated step +
 * autonomous grant, never a plain effect. So a workflow can observe + inform, but can't silently mutate.
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

/** The RBAC-scoped effect surface for a real request (the caller's broker context). */
export function scopedEffects(req: Request, owner: string): WorkflowEffect {
  const bus = getNotifyBus();
  return makeEffects({
    broker: getBroker(),
    ctx: contextFromReq(req),
    owner,
    notify: (n, target) => void bus.publish({ notification: { id: `wf-${n.title}-${Date.now()}`, kind: n.kind, title: n.title, body: n.body, read: false, timestamp: Date.now() }, target }),
  });
}

/** Run a stored workflow by id with the caller's scope. Throws {@link WorkflowRunError} when unknown. */
export async function runStoredWorkflow(req: Request, id: string, owner: string): Promise<WorkflowRunContext> {
  const def: WorkflowDef | undefined = getSettings().workflows.find((w) => w.id === id);
  if (!def) throw new WorkflowRunError(`unknown workflow "${id}"`);
  return runWorkflow(def, scopedEffects(req, owner));
}
