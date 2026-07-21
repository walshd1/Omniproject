import type { Request, Response } from "express";
import { scopeForReq } from "./rbac";
import { inScope, scopeAllowsVisibleProject } from "./scope";
import { getProjects } from "./data";
import { getSettings } from "./settings";
import { programmeIdsOf, programmeIdOf } from "./programmes";
import { qualifiedId } from "../broker/identity";
import { auditScopeDenied } from "./audit";

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
  // A GUEST (project-scoped) may touch ONLY its one invited project — decided by id, nothing else visible.
  if (scope.level === "project") {
    return scope.projectId === projectId ? { ok: true } : { ok: false, error: "project not in your scope" };
  }
  const registry = getSettings().programmeRegistry;
  const visible = await getProjects(req, { includeClosed: true });
  const project = visible.find((p) => String(p["id"]) === projectId || qualifiedId(p) === projectId);
  // Not even in the broker-visible set ⇒ out of scope (fail-closed on an unknown id).
  if (!project) return { ok: false, error: "project not in your scope" };
  // Defence-in-depth for a programme-scoped principal: re-check the project's programme membership at the
  // gateway (the built-in broker doesn't scope-filter its list, so presence in it alone isn't enough).
  // scopeAllowsVisibleProject is the SAME decision the data-seam guard (broker/scope-guard.ts) applies.
  if (!scopeAllowsVisibleProject(scope, { programmeId: programmeIdOf(project), programmeIds: programmeIdsOf(project, registry) })) {
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
  // A cross-scope access attempt — record it (category "security", always audited) so a burst from one
  // actor surfaces as lateral-movement probing, not just a silent 403.
  auditScopeDenied(req, "project", projectId, authz.error);
  res.status(403).json({ error: authz.error });
  return false;
}

/**
 * Express convenience: enforce that the caller is within a PROGRAMME's scope, sending a 403 (and auditing the
 * cross-scope attempt) when not. all-scope (PMO/admin) passes; a programme-scoped principal passes only for a
 * programme they own (`inScope` on programmeIds); everyone narrower is refused. Used by the def
 * importer/editor for a `programme`-target write, so a programme manager's def is confined to their programme.
 */
export function guardProgrammeScope(req: Request, res: Response, programmeId: string): boolean {
  if (inScope(scopeForReq(req), { programmeIds: [programmeId] })) return true;
  auditScopeDenied(req, "programme", programmeId, "programme not in your scope");
  res.status(403).json({ error: "programme not in your scope" });
  return false;
}

/** The minimal task shape the scope check reads (structural, so this stays free of a broker-type import). */
interface ScopableTask { projectId?: string | null; assignee?: string | null; collaborators?: string[] | null }

/**
 * Filter a task LIST to only those the caller may see — the batched form of {@link assertTaskScope} for a
 * list endpoint, resolving the caller's in-scope project set ONCE (not per task). A project-linked task is
 * kept iff its project is in the caller's scope (same visible-set + programme-membership rule as
 * assertProjectScope); a PERSONAL task (no projectId) iff the caller is its assignee/collaborator. all-scope
 * (PMO/admin) sees everything. Without this, `GET /tasks` handed a scope-blind broker `listTasks` back
 * verbatim — leaking out-of-scope project tasks (and other users' personal tasks) by list or by ?projectId.
 */
export async function filterTasksInScope<T extends ScopableTask>(req: Request, tasks: T[], whoami: readonly string[]): Promise<T[]> {
  const scope = scopeForReq(req);
  if (scope.level === "all") return tasks;
  const registry = getSettings().programmeRegistry;
  const visible = await getProjects(req, { includeClosed: true });
  // The caller's in-scope project ids, in BOTH the raw-id and qualified-id forms a task's projectId may take.
  const inScopeIds = new Set<string>();
  for (const p of visible) {
    if (scope.level === "programme"
      && !inScope(scope, { programmeId: programmeIdOf(p), programmeIds: programmeIdsOf(p, registry) })) continue;
    inScopeIds.add(String(p["id"]));
    inScopeIds.add(qualifiedId(p));
  }
  const owns = (v: string | null | undefined): boolean => !!v && whoami.includes(v);
  return tasks.filter((t) => (t.projectId
    ? inScopeIds.has(t.projectId)
    : owns(t.assignee) || (t.collaborators ?? []).some(owns)));
}

/** The caller's in-scope project-id set (both raw and qualified id forms), resolved ONCE from the
 *  broker-visible project list + the programme registry — or `null` for all-scope (everything visible).
 *  The generic building block for scoping settings-stored, per-project collections (resource allocations,
 *  budget plans, …) the same way {@link filterTasksInScope} scopes tasks. */
export async function inScopeProjectIds(req: Request): Promise<Set<string> | null> {
  const scope = scopeForReq(req);
  if (scope.level === "all") return null;
  const registry = getSettings().programmeRegistry;
  const visible = await getProjects(req, { includeClosed: true });
  const ids = new Set<string>();
  for (const p of visible) {
    if (scope.level === "programme"
      && !inScope(scope, { programmeId: programmeIdOf(p), programmeIds: programmeIdsOf(p, registry) })) continue;
    ids.add(String(p["id"]));
    ids.add(qualifiedId(p));
  }
  return ids;
}

/** Filter per-project settings rows to only those the caller's scope permits (all-scope ⇒ unchanged). A
 *  row with no/unknown projectId is treated as out of scope (fail-closed) for a non-all caller. */
export async function filterRowsByProjectScope<T>(req: Request, rows: readonly T[], projectIdOf: (r: T) => string | null | undefined): Promise<T[]> {
  const ids = await inScopeProjectIds(req);
  if (ids === null) return [...rows];
  return rows.filter((r) => { const pid = projectIdOf(r); return !!pid && ids.has(pid); });
}

/**
 * Scope-safe write-merge for a per-project settings collection. A scoped (non-all) caller may only
 * add/replace/remove rows for projects in THEIR scope; every existing OUT-of-scope row is preserved
 * untouched. Any submitted row referencing a project outside the caller's scope is a boundary violation
 * (returns `{ forbidden }`) — so a programme-A manager can never rewrite or inject programme-B's data.
 * all-scope callers get a full replace (the prior behaviour).
 */
export async function mergeRowsByProjectScope<T>(
  req: Request, existing: readonly T[], submitted: readonly T[], projectIdOf: (r: T) => string | null | undefined,
): Promise<{ merged: T[] } | { forbidden: string }> {
  const ids = await inScopeProjectIds(req);
  if (ids === null) return { merged: [...submitted] }; // all-scope: unchanged full replace
  const bad = submitted.find((r) => { const pid = projectIdOf(r); return !pid || !ids.has(pid); });
  if (bad) return { forbidden: "a submitted row references a project outside your scope" };
  const preserved = existing.filter((r) => { const pid = projectIdOf(r); return !pid || !ids.has(pid); });
  return { merged: [...preserved, ...submitted] };
}

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
