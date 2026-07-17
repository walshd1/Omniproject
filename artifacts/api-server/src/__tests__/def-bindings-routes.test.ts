import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/def-bindings.ts over the REAL app (roadmap X.12). Selection bindings record which def is IN USE at a
 * scope, with locks. Scoping is the point: a `project` binding needs manager + that project's scope; `org`
 * needs pmo/admin; `user` is a contributor's own pick; and a lock at a higher scope refuses lower writes.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "defImporter";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "def-bindings-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
// Same admin, but with a FRESH step-up stamped — required now to SET a lock (a lock mandates lower scopes).
const ADMIN_STEPPED = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"], stepUpAt: Date.now() });
const MANAGER = cookie({ sub: "m", name: "Mo", email: "mo@x.io", roles: ["delivery-leads"] });
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? ADMIN, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("a user selects their own def for a slot (their private pick); GET reflects it", async () => {
  const r = await req("/defs/bindings", { method: "PUT", body: { scope: "user", slot: "projects", defId: "user~mine" }, cookie: CONTRIBUTOR });
  assert.equal(r.status, 200);
  const got = (await req("/defs/bindings", { cookie: CONTRIBUTOR }).then((x) => x.json())) as { user: Record<string, { defId: string }> };
  assert.equal(got.user["projects"]?.defId, "user~mine");
});

test("org (pmo/admin) selects + LOCKS a slot; a lower scope can no longer rebind it", async () => {
  // Setting the LOCK requires a fresh step-up (the mandate action); ADMIN_STEPPED carries one.
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "methodology", defId: "system~scrum", locked: true }, cookie: ADMIN_STEPPED })).status, 200);
  const got = (await req("/defs/bindings").then((x) => x.json())) as { org: Record<string, { defId: string; locked?: boolean }> };
  assert.equal(got.org["methodology"]?.locked, true);
  // A user trying to pick their own methodology is refused — the org mandate wins (409).
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "user", slot: "methodology", defId: "user~kanban" }, cookie: CONTRIBUTOR })).status, 409);
});

test("setting a LOCK needs a fresh step-up; a plain selection does not", async () => {
  // A stale (no step-up) admin can SELECT an org def...
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "dash", defId: "system~a" }, cookie: ADMIN })).status, 200);
  // ...but is refused when it tries to LOCK it (403), because a lock mandates lower scopes.
  const denied = await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "dash", defId: "system~a", locked: true }, cookie: ADMIN });
  assert.equal(denied.status, 403);
  assert.match(((await denied.json()) as { error: string }).error, /step-up/i);
  // With a fresh step-up the same lock succeeds.
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "dash", defId: "system~a", locked: true }, cookie: ADMIN_STEPPED })).status, 200);
});

test("a programme binding lives in THAT programme's scope; GET reflects it with ?programmeId", async () => {
  // Demo mode: the admin resolves to all-scope, so it clears the programmeManager gate and programme scope.
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "screens", defId: "programme~x", programmeId: "prog-1" } })).status, 200);
  const inProg = (await req("/defs/bindings?programmeId=prog-1").then((x) => x.json())) as { programme: Record<string, { defId: string }> };
  assert.equal(inProg.programme["screens"]?.defId, "programme~x");
  // Without the programmeId the tier is skipped entirely (it's opt-in) — the programme map is empty.
  const noProg = (await req("/defs/bindings").then((x) => x.json())) as { programme: Record<string, unknown> };
  assert.deepEqual(noProg.programme, {});
});

test("RBAC + scope: a programme binding needs programmeManager AND that programme's scope", async () => {
  const prev = {
    iss: process.env["OIDC_ISSUER_URL"], c: process.env["OIDC_CONTRIBUTOR_ROLES"],
    pm: process.env["OIDC_PROGRAMME_MANAGER_ROLES"], pre: process.env["OIDC_PROGRAMME_GROUP_PREFIX"],
  };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  process.env["OIDC_PROGRAMME_MANAGER_ROLES"] = "programme-leads";
  process.env["OIDC_PROGRAMME_GROUP_PREFIX"] = "programme:";
  // A programme lead who OWNS programme "alpha" (group programme:alpha), and one who owns only "beta".
  const pmAlpha = cookie({ sub: "pa", roles: ["programme-leads", "programme:alpha"] });
  const contributor = cookie({ sub: "cc", roles: ["omni-contributors"] });
  try {
    // A plain contributor lacks the programmeManager rung → 403.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "s", defId: "programme~x", programmeId: "alpha" }, cookie: contributor })).status, 403);
    // The programme lead can bind their OWN programme.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "s", defId: "programme~x", programmeId: "alpha" }, cookie: pmAlpha })).status, 200);
    // ...but not a programme they don't own — out of scope (403), so a lead's change can't leak sideways.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "s", defId: "programme~y", programmeId: "beta" }, cookie: pmAlpha })).status, 403);
    // A programme lead can SELECT but not LOCK without a fresh step-up.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "s2", defId: "programme~z", programmeId: "alpha", locked: true }, cookie: pmAlpha })).status, 403);
    const pmAlphaStepped = cookie({ sub: "pa", roles: ["programme-leads", "programme:alpha"], stepUpAt: Date.now() });
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "programme", slot: "s2", defId: "programme~z", programmeId: "alpha", locked: true }, cookie: pmAlphaStepped })).status, 200);
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c], ["OIDC_PROGRAMME_MANAGER_ROLES", prev.pm], ["OIDC_PROGRAMME_GROUP_PREFIX", prev.pre]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("a project binding is confined to THAT project's scope (a PM's change can't leak to another project)", async () => {
  // ADMIN in demo mode clears the project-scope gate; the point here is the STORAGE scoping.
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "project", slot: "projects", defId: "project~alpha", projectId: "proj-alpha" } })).status, 200);
  const inAlpha = (await req("/defs/bindings?projectId=proj-alpha").then((x) => x.json())) as { project: Record<string, { defId: string }> };
  assert.equal(inAlpha.project["projects"]?.defId, "project~alpha");
  // A different project doesn't see it.
  const inBeta = (await req("/defs/bindings?projectId=proj-beta").then((x) => x.json())) as { project: Record<string, unknown> };
  assert.equal(inBeta.project["projects"], undefined);
});

test("clearing a binding removes the slot", async () => {
  await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "reports", defId: "org~r" } });
  assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "reports", defId: null } })).status, 200);
  const got = (await req("/defs/bindings").then((x) => x.json())) as { org: Record<string, unknown> };
  assert.equal(got.org["reports"], undefined);
});

test("RBAC: project needs manager, org needs pmo/admin", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], c: process.env["OIDC_CONTRIBUTOR_ROLES"], m: process.env["OIDC_MANAGER_ROLES"], a: process.env["OIDC_ADMIN_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  process.env["OIDC_MANAGER_ROLES"] = "delivery-leads";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  try {
    // A contributor can set their OWN pick but is blocked at the project + org role gates.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "user", slot: "s", defId: "user~x" }, cookie: CONTRIBUTOR })).status, 200);
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "project", slot: "s", defId: "project~x", projectId: "proj-001" }, cookie: CONTRIBUTOR })).status, 403);
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "s", defId: "org~x" }, cookie: CONTRIBUTOR })).status, 403);
    // A manager clears the project ROLE gate (the project-SCOPE gate — being assigned to that project — is
    // enforced separately by assertProjectScope), but a manager can't set an ORG binding.
    assert.equal((await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "s", defId: "org~x" }, cookie: MANAGER })).status, 403);
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c], ["OIDC_MANAGER_ROLES", prev.m], ["OIDC_ADMIN_ROLES", prev.a]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
