import type { Request, Response } from "express";
import { scopeForReq } from "./rbac";
import { inScope } from "./scope";
import { getProjects } from "./data";
import { getSettings } from "./settings";
import { programmeIdsOf, programmeIdOf } from "./programmes";
import { qualifiedId } from "../broker/identity";

/**
 * Gateway-side per-project authorization — the deployment-independent scope gate every
 * `/:projectId` handler needs.
 *
 * The broker only enforces caller scope on `listProjects` (the visible set) and `updateProject`; every
 * other per-project read/write method ignores it (external brokers can't know OmniProject's programme
 * model at all). So a per-project route that hands a caller-supplied `:projectId` straight to the broker
 * is an IDOR — a programme/user-scoped principal could read or mutate any project by naming its id, the
 * same hole `GET /history/trends` had. This re-derives scope at the gateway from the SAME broker-visible
 * set every other read uses, and — for a programme-scoped principal — re-checks the project's programme
 * membership against the registry (so it holds even for a broker that doesn't scope-filter its list).
 *
 * Fail-closed: an id the caller can't already see is refused, not leaked.
 */
export async function assertProjectScope(req: Request, projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const scope = scopeForReq(req);
  if (scope.level === "all") return { ok: true }; // PMO/admin (and demo) see everything
  const registry = getSettings().programmeRegistry;
  const visible = await getProjects(req, { includeClosed: true });
  const project = visible.find((p) => String(p["id"]) === projectId || qualifiedId(p) === projectId);
  // Not even in the broker-visible set ⇒ out of scope (fail-closed on an unknown id).
  if (!project) return { ok: false, error: "project not in your scope" };
  // Defence-in-depth for a programme-scoped principal: re-check the project's programme membership at the
  // gateway (the built-in broker doesn't scope-filter its list, so presence in it alone isn't enough).
  if (scope.level === "programme"
    && !inScope(scope, { programmeId: programmeIdOf(project), programmeIds: programmeIdsOf(project, registry) })) {
    return { ok: false, error: "project not in your scope" };
  }
  return { ok: true };
}

/**
 * Express convenience: enforce {@link assertProjectScope}, sending a 403 and returning false when the
 * caller is out of scope. Usage in a handler: `if (!(await guardProjectScope(req, res, projectId))) return;`
 */
export async function guardProjectScope(req: Request, res: Response, projectId: string): Promise<boolean> {
  const authz = await assertProjectScope(req, projectId);
  if (authz.ok) return true;
  res.status(403).json({ error: authz.error });
  return false;
}

/** The minimal task shape the scope check reads (structural, so this stays free of a broker-type import). */
interface ScopableTask { projectId?: string | null; assignee?: string | null; collaborators?: string[] | null }

/**
 * Whether a caller may see/mutate a single task. A PROJECT-linked task follows {@link assertProjectScope}
 * (a manager may act on tasks in projects they can see). A PERSONAL task (no projectId) is private to its
 * owner — only the assignee or a collaborator, matched against the caller's identity tokens (`whoami` =
 * sub/email/name). all-scope (PMO/admin) sees everything. Pass the identity in so this lib helper stays
 * decoupled from the session/route layer.
 */
export async function assertTaskScope(req: Request, task: ScopableTask, whoami: readonly string[]): Promise<boolean> {
  if (scopeForReq(req).level === "all") return true;
  if (task.projectId) return (await assertProjectScope(req, task.projectId)).ok;
  const owns = (v: string | null | undefined): boolean => !!v && whoami.includes(v);
  return owns(task.assignee) || (task.collaborators ?? []).some(owns);
}
