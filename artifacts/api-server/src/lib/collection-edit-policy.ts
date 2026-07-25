import type { Request, Response, NextFunction } from "express";
import { grantsForReq, grantsSatisfy, roleForReq, ROLES, type Role } from "./rbac";
import { readConfigCollection } from "./scoped-config";

/**
 * Configurable per-collection EDIT policy for screen content. The product default is "content is
 * user-editable"; an admin/PMO can raise the bar per collection (e.g. "only manager+ may edit RACI") or set
 * it read-only. Stored in `settings.collectionEditRoles` (collectionKey → a Role, or "readonly"). This is the
 * SERVER enforcement that backs the on-screen editable registers — the SPA reads the same policy to show or
 * hide the edit controls, but the write is only allowed here.
 */
export type EditPolicy = Role | "readonly";
const VALID = new Set<string>([...ROLES, "readonly"]);

/** The configured policy for a collection, or undefined to fall back to the route's default. */
export function editPolicyFor(collection: string): EditPolicy | undefined {
  const v = readConfigCollection<Record<string, string>>("collection-edit-roles", {})[collection];
  return typeof v === "string" && VALID.has(v) ? (v as EditPolicy) : undefined;
}

/**
 * Express guard for a collection's WRITE. Allows it only when the caller meets the collection's configured
 * minimum role (default `fallback` when unset), and never when the collection is set read-only. Keeps the
 * "default user-editable, admin-tunable" model enforced server-side, not just in the UI.
 */
export function requireCollectionEdit(collection: string, fallback: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const policy = editPolicyFor(collection) ?? fallback;
    if (policy === "readonly") {
      res.status(403).json({ error: `“${collection}” is set to read-only for this deployment.` });
      return;
    }
    if (grantsSatisfy(grantsForReq(req), policy)) {
      next();
      return;
    }
    res.status(403).json({ error: `Editing “${collection}” requires at least the ${policy} role (you are ${roleForReq(req)}).` });
  };
}
