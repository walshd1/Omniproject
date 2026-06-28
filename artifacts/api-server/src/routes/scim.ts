import { Router, type Request, type Response, type NextFunction } from "express";
import {
  scimEnabled, scimTokenValid,
  createUser, getUser, replaceUser, patchUser, deleteUser, listUsers,
  createGroup, getGroup, replaceGroup, patchGroup, deleteGroup, listGroups,
  type ScimUser, type ScimGroup,
} from "../lib/scim";
import { recordAudit } from "../lib/audit";

/**
 * SCIM 2.0 provisioning endpoints (RFC 7644). The IdP (Okta / Entra) drives user + group
 * lifecycle here with a bearer token (SCIM_TOKEN) — separate from user sessions. Disabled
 * (404) unless SCIM_TOKEN is set. All mutations are audited.
 */
const router = Router();
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

function scimError(res: Response, status: number, detail: string): void {
  res.status(status).type("application/scim+json").json({ schemas: [ERROR_SCHEMA], detail, status: String(status) });
}

// Bearer-token auth for the whole SCIM surface. Off ⇒ 404 (feature hidden); bad token ⇒ 401.
function scimAuth(req: Request, res: Response, next: NextFunction): void {
  if (!scimEnabled()) { scimError(res, 404, "SCIM is not enabled."); return; }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!scimTokenValid(token)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    scimError(res, 401, "Invalid SCIM token.");
    return;
  }
  next();
}
router.use("/scim/v2", scimAuth);

function userResource(u: ScimUser): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    userName: u.userName,
    externalId: u.externalId,
    active: u.active,
    displayName: u.displayName,
    emails: u.emails,
    groups: (u.groups ?? []).map((g) => ({ display: g })),
    meta: { ...u.meta, location: `/scim/v2/Users/${u.id}` },
  };
}
function groupResource(g: ScimGroup): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: g.id,
    displayName: g.displayName,
    externalId: g.externalId,
    members: g.members.map((m) => ({ value: m.value })),
    meta: { ...g.meta, location: `/scim/v2/Groups/${g.id}` },
  };
}
function listResponse(res: Response, resources: Record<string, unknown>[], startIndex = 1): void {
  res.type("application/scim+json").json({
    schemas: [LIST_SCHEMA],
    totalResults: resources.length,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}
function audit(action: string, meta: Record<string, unknown>): void {
  recordAudit({ ts: new Date().toISOString(), category: "admin", action, actor: { sub: "scim" }, write: true, result: "success", meta });
}

// ── Discovery ────────────────────────────────────────────────────────────────────
router.get("/scim/v2/ServiceProviderConfig", (_req, res) => {
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Authentication via the SCIM bearer token." }],
  });
});
router.get("/scim/v2/ResourceTypes", (_req, res) => {
  listResponse(res, [
    { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER_SCHEMA },
    { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: GROUP_SCHEMA },
  ]);
});
router.get("/scim/v2/Schemas", (_req, res) => {
  listResponse(res, [{ id: USER_SCHEMA, name: "User" }, { id: GROUP_SCHEMA, name: "Group" }]);
});

// ── Users ──────────────────────────────────────────────────────────────────────
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

router.get("/scim/v2/Users", (req, res) => {
  listResponse(res, listUsers(asString(req.query["filter"])).map(userResource));
});
router.post("/scim/v2/Users", (req, res) => {
  const b = (req.body ?? {}) as Partial<ScimUser>;
  if (!b.userName) { scimError(res, 400, "userName is required."); return; }
  const u = createUser({ userName: b.userName, externalId: b.externalId, active: b.active, displayName: b.displayName, emails: b.emails });
  audit("scim.user.create", { id: u.id, userName: u.userName });
  res.status(201).type("application/scim+json").json(userResource(u));
});
router.get("/scim/v2/Users/:id", (req, res) => {
  const u = getUser(String(req.params["id"]));
  if (!u) { scimError(res, 404, "User not found."); return; }
  res.type("application/scim+json").json(userResource(u));
});
router.put("/scim/v2/Users/:id", (req, res) => {
  const u = replaceUser(String(req.params["id"]), (req.body ?? {}) as Partial<ScimUser>);
  if (!u) { scimError(res, 404, "User not found."); return; }
  audit("scim.user.replace", { id: u.id, active: u.active });
  res.type("application/scim+json").json(userResource(u));
});
router.patch("/scim/v2/Users/:id", (req, res) => {
  const ops = ((req.body ?? {}) as { Operations?: unknown }).Operations;
  if (!Array.isArray(ops)) { scimError(res, 400, "PATCH requires Operations[]."); return; }
  const u = patchUser(String(req.params["id"]), ops as Array<{ op: string; path?: string; value?: unknown }>);
  if (!u) { scimError(res, 404, "User not found."); return; }
  audit("scim.user.patch", { id: u.id, active: u.active }); // deprovision (active=false) lands here
  res.type("application/scim+json").json(userResource(u));
});
router.delete("/scim/v2/Users/:id", (req, res) => {
  const id = String(req.params["id"]);
  if (!deleteUser(id)) { scimError(res, 404, "User not found."); return; }
  audit("scim.user.delete", { id });
  res.status(204).end();
});

// ── Groups ───────────────────────────────────────────────────────────────────────
router.get("/scim/v2/Groups", (req, res) => {
  listResponse(res, listGroups(asString(req.query["filter"])).map(groupResource));
});
router.post("/scim/v2/Groups", (req, res) => {
  const b = (req.body ?? {}) as Partial<ScimGroup>;
  if (!b.displayName) { scimError(res, 400, "displayName is required."); return; }
  const g = createGroup({ displayName: b.displayName, externalId: b.externalId, members: b.members });
  audit("scim.group.create", { id: g.id, displayName: g.displayName });
  res.status(201).type("application/scim+json").json(groupResource(g));
});
router.get("/scim/v2/Groups/:id", (req, res) => {
  const g = getGroup(String(req.params["id"]));
  if (!g) { scimError(res, 404, "Group not found."); return; }
  res.type("application/scim+json").json(groupResource(g));
});
router.put("/scim/v2/Groups/:id", (req, res) => {
  const g = replaceGroup(String(req.params["id"]), (req.body ?? {}) as Partial<ScimGroup>);
  if (!g) { scimError(res, 404, "Group not found."); return; }
  audit("scim.group.replace", { id: g.id });
  res.type("application/scim+json").json(groupResource(g));
});
router.patch("/scim/v2/Groups/:id", (req, res) => {
  const ops = ((req.body ?? {}) as { Operations?: unknown }).Operations;
  if (!Array.isArray(ops)) { scimError(res, 400, "PATCH requires Operations[]."); return; }
  const g = patchGroup(String(req.params["id"]), ops as Array<{ op: string; path?: string; value?: unknown }>);
  if (!g) { scimError(res, 404, "Group not found."); return; }
  audit("scim.group.patch", { id: g.id });
  res.type("application/scim+json").json(groupResource(g));
});
router.delete("/scim/v2/Groups/:id", (req, res) => {
  const id = String(req.params["id"]);
  if (!deleteGroup(id)) { scimError(res, 404, "Group not found."); return; }
  audit("scim.group.delete", { id });
  res.status(204).end();
});

export default router;
