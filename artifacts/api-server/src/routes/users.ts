import { Router, type Response, type Request } from "express";
import { requireRole } from "../lib/rbac";
import { getSession } from "./auth";
import { recordAudit, actorForAudit } from "../lib/audit";
import {
  listUsers, getUserView, createUser, updateUser, deleteUser, userDirectoryEnabled, UserDirectoryError,
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

/** Record a successful admin user-management action. */
function audit(req: Request, action: string, meta?: Record<string, unknown>): void {
  recordAudit({ ts: new Date().toISOString(), category: "request", action, actor: actorForAudit(req), write: true, result: "success", ...(meta ? { meta } : {}) });
}

router.get("/users", requireRole("admin"), (_req, res) => {
  if (!ensureAvailable(res)) return;
  res.json({ users: listUsers() });
});

router.post("/users", requireRole("admin"), (req, res) => {
  if (!ensureAvailable(res)) return;
  const body = (req.body ?? {}) as { userName?: unknown; displayName?: unknown; email?: unknown; groups?: unknown; active?: unknown; password?: unknown };
  const now = new Date().toISOString();
  const actor = getSession(req)?.sub ?? null;
  try {
    // A password, when supplied, must clear the policy BEFORE the user is created — so a rejected password never
    // leaves a half-created passwordless user behind.
    if (body.password !== undefined && body.password !== null && body.password !== "") assertPasswordPolicy(body.password);
    const user = createUser({ userName: body.userName, displayName: body.displayName, email: body.email, groups: body.groups, active: body.active }, actor, now);
    if (body.password !== undefined && body.password !== null && body.password !== "") setPassword(user.id, body.password as string);
    audit(req, "users.create", { sub: user.id });
    res.status(201).json({ user: getUserView(user.id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "could not create the user";
    res.status(e instanceof UserDirectoryError || msg.includes("password") ? 400 : 500).json({ error: msg });
  }
});

router.patch("/users/:id", requireRole("admin"), (req, res) => {
  if (!ensureAvailable(res)) return;
  const id = pid(req);
  const body = (req.body ?? {}) as { displayName?: unknown; email?: unknown; groups?: unknown; active?: unknown };
  try {
    const updated = updateUser(id, body, new Date().toISOString());
    if (!updated) { res.status(404).json({ error: "No such user." }); return; }
    audit(req, "users.update", { sub: id });
    res.json({ user: updated });
  } catch (e) {
    res.status(e instanceof UserDirectoryError ? 400 : 500).json({ error: e instanceof Error ? e.message : "could not update the user" });
  }
});

router.post("/users/:id/password", requireRole("admin"), (req, res) => {
  if (!ensureAvailable(res)) return;
  const id = pid(req);
  if (!getUserView(id)) { res.status(404).json({ error: "No such user." }); return; }
  const password = (req.body as { password?: unknown } | undefined)?.password;
  try {
    assertPasswordPolicy(password);
    setPassword(id, password);
    audit(req, "users.password.set", { sub: id });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid password" });
  }
});

router.delete("/users/:id/password", requireRole("admin"), (req, res) => {
  if (!ensureAvailable(res)) return;
  const id = pid(req);
  if (!getUserView(id)) { res.status(404).json({ error: "No such user." }); return; }
  removePassword(id);
  audit(req, "users.password.clear", { sub: id });
  res.json({ ok: true });
});

router.delete("/users/:id", requireRole("admin"), (req, res) => {
  if (!ensureAvailable(res)) return;
  const id = pid(req);
  const removed = deleteUser(id);
  if (!removed) { res.status(404).json({ error: "No such user." }); return; }
  audit(req, "users.delete", { sub: id });
  res.json({ ok: true });
});

export default router;
