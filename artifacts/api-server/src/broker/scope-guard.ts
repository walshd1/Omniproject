import type { Broker, ActorContext } from "./types";
import { BrokerError } from "./types";
import type { Scope } from "../lib/scope";
import { scopeAllowsVisibleProject } from "../lib/scope";
import { getSettings } from "../lib/settings";
import { programmeIdOf, programmeIdsOf } from "../lib/programmes";
import { qualifiedId } from "./identity";

/**
 * Data-seam scope guard (defense in depth). The gateway enforces per-project scope before it calls the
 * broker (guardProjectScope/assertProjectScope), but that is a SINGLE layer: one route that forgets the
 * guard is an IDOR. This wraps the FIRST-PARTY brokers OmniProject scopes for itself (the built-in store
 * and the demo broker) so the same decision is re-applied at the data layer — a missing gateway guard
 * then leaks nothing, because the store itself refuses a cross-scope project.
 *
 * It uses the caller's forwarded `ctx.scope` and the SAME pure decision the gateway uses
 * (scopeAllowsVisibleProject), so a read the gateway allowed is never wrongly denied here — no drift.
 * all-scope (PMO/admin) and system/unauthenticated (no scope) calls pass straight through; only a
 * user/programme principal is checked. A real EXTERNAL broker is NOT wrapped — it enforces the forwarded
 * scope itself from the PSK-signed envelope, and knows its own visibility model.
 */

// Per-project methods whose SECOND positional argument is the projectId. writeIssue (projectId lives in
// the input body) and the task methods (taskId; guarded by assertTaskScope) are covered at the gateway;
// these positional-projectId reads/writes are the high-value seam backstop.
const PROJECT_ID_AT_ARG1 = new Set<string>([
  "projectMembers", "listIssues", "getIssue", "listTaskItems", "createTaskItem",
  "projectSummary", "projectHistory", "baseline", "listRaid", "addRaid",
  "resourceCapacity", "projectFinancials", "updateProject",
]);

async function assertProjectInScope(base: Broker, ctx: ActorContext, scope: Scope, projectId: string): Promise<void> {
  // Resolve the project from the broker's OWN visible list (base = inner broker, not the proxy — no
  // recursion). Not present ⇒ not visible ⇒ refuse (fail-closed, mirroring the gateway's unknown-id case).
  const projects = await base.listProjects(ctx);
  const project = projects.find((p) => String(p["id"]) === projectId || qualifiedId(p) === projectId);
  if (!project) throw new BrokerError("unauthorized", "project not in your scope");
  const registry = getSettings().programmeRegistry;
  if (!scopeAllowsVisibleProject(scope, { programmeId: programmeIdOf(project), programmeIds: programmeIdsOf(project, registry) })) {
    throw new BrokerError("unauthorized", "project not in your scope");
  }
}

/** Wrap a first-party broker so every positional-projectId method re-checks the caller's data scope. */
export function wrapWithScopeGuard(base: Broker): Broker {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof orig !== "function" || !PROJECT_ID_AT_ARG1.has(prop)) return orig;
      return async function scopeGuarded(ctx: ActorContext, projectId: string, ...rest: unknown[]): Promise<unknown> {
        const scope = ctx?.scope;
        // Enforce only for a genuine user/programme principal; all-scope and system calls pass through.
        if (scope && scope.level !== "all" && typeof projectId === "string" && projectId) {
          await assertProjectInScope(target as Broker, ctx, scope, projectId);
        }
        return (orig as (...a: unknown[]) => unknown).call(target, ctx, projectId, ...rest);
      };
    },
  });
}
