import { Router, type Response, type Request } from "express";
import { requireRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { getSession } from "./auth";
import {
  listUsers, getUserView, createUser, updateUser, deleteUser, userDirectoryEnabled, UserDirectoryError,
  type CreateUserInput,
} from "../lib/user-directory";
import { setPassword, removePassword, credentialsEnabled, assertPasswordPolicy } from "../lib/user-credentials";
import { localPasswordsAllowed } from "../lib/auth-config";

/**
 * NATIVE USER MANAGEMENT (admin) — create/manage in-app users + assign their groups (which map to roles the
 * same way IdP claims do), so a deployment can run WITHOUT an external IdP. Passwords are set here but stored in
 * the SEPARATELY-KEYED credential store (never returned). Admin-gated; OIDC/SAML/SCIM keep working alongside.
 *
 *  - GET    /api/users                     list users (no secrets; hasPassword is presence-only)
 *  - POST   /api/users                     create a user (+ optional initial password)
 *  - PATCH  /api/users/:id                 update profile / groups / active
 *  - POST   /api/users/:id/password        set or replace a user's password
 *  - DELETE /api/users/:id/password        clear a user's password (they can't sign in until a new one is set)
 *  - DELETE /api/users/:id                 delete a user (+ their credential)
 *
 * LANE 2 — every write is admin + audit-on-success, the action-base shell. Each is a mountCommand descriptor:
 * requireRole(admin) → parse (the availability guard + validation/404) → ruleset → run → audit → respond.
 * The availability 404 + password-policy 400 + "no such user" 404 all live in `parse`; the two writes whose
 * "not found" is only known AFTER the mutation attempt (update / delete) throw UserNotFoundError from `run`
 * and map to 404 via `onError` — so a not-found records NO success audit, exactly as the hand-written 404
 * returns did. `category:"request"` (the action-base default) + `auditMeta{sub}` keep the audit byte-identical.
 */
const router = Router();

/** 404 the whole plane when the roster/credential store isn't configured, OR when a stronger SSO tier has
 *  disabled in-app users (downgrade prevention) — the recovery break-glass is the only way back. */
function ensureAvailable(res: Response): boolean {
  if (userDirectoryEnabled() && credentialsEnabled() && localPasswordsAllowed()) return true;
  res.status(404).json({ error: "In-app user management is not available on this deployment (no encrypted store, or disabled by a configured identity provider)." });
  return false;
}

/** The `:id` path param as a plain string. */
const pid = (req: Request): string => String(req.params["id"] ?? "");

/** Raised inside a command's `run` when the target user doesn't exist — mapped to 404 by `onError`, so no
 *  success audit fires (unlike a `run` that returns normally). Mirrors the old `if (!updated) 404` returns. */
class UserNotFoundError extends Error {}

router.get("/users", requireRole("admin"), (_req, res) => {
  if (!ensureAvailable(res)) return;
  res.json({ users: listUsers() });
});

// POST /api/users — create a user (+ optional initial password).
export const userCreateCommand: CommandDescriptor<{ body: CreateUserInput; password: string | null }> = {
  name: "users.create",
  method: "post",
  path: "/users",
  role: "admin",
  parse: (req, res) => {
    if (!ensureAvailable(res)) return null;
    const b = (req.body ?? {}) as CreateUserInput & { password?: unknown };
    // A password, when supplied, must clear the policy BEFORE the user is created — so a rejected password
    // never leaves a half-created passwordless user behind. (parse runs before run, so this fails first.)
    const password = b.password !== undefined && b.password !== null && b.password !== "" ? b.password : null;
    if (password !== null) {
      try {
        assertPasswordPolicy(password);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : "invalid password" });
        return null;
      }
    }
    return { body: { userName: b.userName, displayName: b.displayName, email: b.email, groups: b.groups, active: b.active }, password };
  },
  run: async (req, _res, { body, password }) => {
    const now = new Date().toISOString();
    const actor = getSession(req)?.sub ?? null;
    const user = createUser(body, actor, now);
    if (password !== null) setPassword(user.id, password);
    return { user: getUserView(user.id) };
  },
  status: 201,
  audit: "users.create",
  auditMeta: (_req, _args, result) => ({ sub: (result as { user?: { id?: string } }).user?.id }),
  onError: (res, err) => {
    const msg = err instanceof Error ? err.message : "could not create the user";
    res.status(err instanceof UserDirectoryError || msg.includes("password") ? 400 : 500).json({ error: msg });
  },
};
mountCommand(router, userCreateCommand);

// PATCH /api/users/:id — update profile / groups / active.
export const userUpdateCommand: CommandDescriptor<{ id: string; body: Record<string, unknown> }> = {
  name: "users.update",
  method: "patch",
  path: "/users/:id",
  role: "admin",
  parse: (req, res) => {
    if (!ensureAvailable(res)) return null;
    return { id: pid(req), body: (req.body ?? {}) as Record<string, unknown> };
  },
  run: async (_req, _res, { id, body }) => {
    const updated = updateUser(id, body, new Date().toISOString());
    if (!updated) throw new UserNotFoundError();
    return { user: updated };
  },
  audit: "users.update",
  auditMeta: (_req, { id }) => ({ sub: id }),
  onError: (res, err) => {
    if (err instanceof UserNotFoundError) { res.status(404).json({ error: "No such user." }); return; }
    res.status(err instanceof UserDirectoryError ? 400 : 500).json({ error: err instanceof Error ? err.message : "could not update the user" });
  },
};
mountCommand(router, userUpdateCommand);

// POST /api/users/:id/password — set or replace a user's password.
export const userPasswordSetCommand: CommandDescriptor<{ id: string; password: string }> = {
  name: "users.password.set",
  method: "post",
  path: "/users/:id/password",
  role: "admin",
  parse: (req, res) => {
    if (!ensureAvailable(res)) return null;
    const id = pid(req);
    if (!getUserView(id)) { res.status(404).json({ error: "No such user." }); return null; }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    try {
      assertPasswordPolicy(password);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "invalid password" });
      return null;
    }
    return { id, password };
  },
  run: async (_req, _res, { id, password }) => { setPassword(id, password); return { ok: true }; },
  audit: "users.password.set",
  auditMeta: (_req, { id }) => ({ sub: id }),
};
mountCommand(router, userPasswordSetCommand);

// DELETE /api/users/:id/password — clear a user's password.
export const userPasswordClearCommand: CommandDescriptor<{ id: string }> = {
  name: "users.password.clear",
  method: "delete",
  path: "/users/:id/password",
  role: "admin",
  parse: (req, res) => {
    if (!ensureAvailable(res)) return null;
    const id = pid(req);
    if (!getUserView(id)) { res.status(404).json({ error: "No such user." }); return null; }
    return { id };
  },
  run: async (_req, _res, { id }) => { removePassword(id); return { ok: true }; },
  audit: "users.password.clear",
  auditMeta: (_req, { id }) => ({ sub: id }),
};
mountCommand(router, userPasswordClearCommand);

// DELETE /api/users/:id — delete a user (+ their credential).
export const userDeleteCommand: CommandDescriptor<{ id: string }> = {
  name: "users.delete",
  method: "delete",
  path: "/users/:id",
  role: "admin",
  parse: (req, res) => {
    if (!ensureAvailable(res)) return null;
    return { id: pid(req) };
  },
  run: async (_req, _res, { id }) => {
    if (!deleteUser(id)) throw new UserNotFoundError();
    return { ok: true };
  },
  audit: "users.delete",
  auditMeta: (_req, { id }) => ({ sub: id }),
  onError: (res, err) => { if (err instanceof UserNotFoundError) { res.status(404).json({ error: "No such user." }); return; } throw err; },
};
mountCommand(router, userDeleteCommand);

export default router;
