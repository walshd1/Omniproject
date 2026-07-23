import type { IRouter, Request, Response } from "express";
import { withBrokerErrors } from "../broker";
import { requireRole, type Role } from "./rbac";
import { guardProjectScope } from "./project-scope";
import { enforceBusinessRules } from "./ruleset-guard";

/**
 * LANE 1 — the generic ENTITY pipeline. A domain entity (issue, task, goal, …) is created/updated/deleted
 * by ONE fixed sequence of gates: RBAC → validate the body → scope (IDOR) → business ruleset → the write.
 * A descriptor supplies the per-entity pieces (role, schema, scope key, rule action, broker op); this
 * mounter enforces the ORDER, so a gate can never be forgotten — the "perms + validation + rules" guarantee
 * holds by construction, not by 236 people remembering. It generalises the settingsCollectionRouter factory
 * (which already does this for config collections) to first-class domain entities.
 *
 * Gate order matches the codebase convention (routes/projects.passesBusinessRules runs before the scope
 * guard): validate → ruleset → scope → run. The ruleset only evaluates (no data access), so running it
 * before the IDOR guard is safe, and the guard still fail-closes the write.
 */

/** How an op derives its project scope for the IDOR guard + the ruleset's scope-tightened overrides. */
export type EntityScope =
  | { kind: "project"; param: string }   // req.params[param] is the projectId; guardProjectScope enforces it
  | { kind: "none" }                      // org-global entity — no per-project scope
  | { kind: "custom"; guard: (req: Request, res: Response) => Promise<boolean> };
                                          // the op's own scope guard (e.g. a task-access check that isn't a
                                          // project IDOR); returns false having ALREADY sent a 4xx, like guardProjectScope

export interface EntityOp<B> {
  /** RBAC floor for this op. */
  role: Role;
  /** Business-ruleset action ("create_issue", "update_issue", …). */
  ruleAction: string;
  /** Validate the request into a typed body, or return null having ALREADY sent a 4xx. Delete ops that
   *  carry no body return an empty object. */
  validate: (req: Request, res: Response) => B | null;
  /** The effect. Return the response payload (the mounter sends it with `status`), or `undefined` when the
   *  op has already written the response itself (e.g. a 404 for an unknown id, or a 204 delete). */
  run: (req: Request, res: Response, body: B) => Promise<unknown>;
  /** Success status when `run` returns a payload (default: 201 create / 200 update). */
  status?: number;
}

export interface EntityDescriptor {
  /** Entity name — the label in errors/audit and the ratchet. */
  entity: string;
  /** Collection path, e.g. "/projects/:projectId/issues". */
  basePath: string;
  /** The id path-param for item ops (update/delete); appended to basePath as `/:idParam`. */
  idParam?: string;
  scope: EntityScope;
  create?: EntityOp<unknown>;
  update?: EntityOp<unknown>;
  remove?: EntityOp<unknown>;
}

const projectIdOf = (req: Request, scope: EntityScope): string | null =>
  scope.kind === "project" ? String(req.params[scope.param] ?? "") : null;

function runOp(entity: string, verb: string, op: EntityOp<unknown>, scope: EntityScope, defaultStatus: number) {
  return (req: Request, res: Response): Promise<void> => {
    const projectId = projectIdOf(req, scope);
    return withBrokerErrors(req, res, `${verb}_${entity} failed`, async () => {
      const body = op.validate(req, res);
      if (body === null) return;
      if (!enforceBusinessRules(req, res, op.ruleAction, { projectId, payload: (body ?? {}) as Record<string, unknown> })) return;
      if (scope.kind === "project" && !(await guardProjectScope(req, res, projectId!))) return;
      if (scope.kind === "custom" && !(await scope.guard(req, res))) return;
      const result = await op.run(req, res, body);
      if (result === undefined) return; // the op already responded (404 / 204 / etc.)
      res.status(op.status ?? defaultStatus).json(result);
    }, projectId ? { projectId } : {});
  };
}

/** The "METHOD /path" routes a descriptor contributes — for the write-lane ratchet. */
export function entityRoutes(desc: EntityDescriptor): string[] {
  const out: string[] = [];
  const itemPath = desc.idParam ? `${desc.basePath}/:${desc.idParam}` : desc.basePath;
  if (desc.create) out.push(`POST ${desc.basePath}`);
  if (desc.update) out.push(`PATCH ${itemPath}`);
  if (desc.remove) out.push(`DELETE ${itemPath}`);
  return out;
}

/** Mount an entity descriptor's ops, each running the fixed RBAC → validate → ruleset → scope → run pipeline. */
export function mountEntity(router: IRouter, desc: EntityDescriptor): void {
  const itemPath = desc.idParam ? `${desc.basePath}/:${desc.idParam}` : desc.basePath;
  if (desc.create) router.post(desc.basePath, requireRole(desc.create.role), runOp(desc.entity, "create", desc.create, desc.scope, 201));
  if (desc.update) router.patch(itemPath, requireRole(desc.update.role), runOp(desc.entity, "update", desc.update, desc.scope, 200));
  if (desc.remove) router.delete(itemPath, requireRole(desc.remove.role), runOp(desc.entity, "delete", desc.remove, desc.scope, 200));
}
