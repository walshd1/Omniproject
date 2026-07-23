import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * HTTP coverage for the SCIM 2.0 provisioning surface. Env is set BEFORE importing the app
 * so SCIM is enabled at module load. The IdP authenticates with the SCIM bearer token.
 */
process.env["SESSION_SECRET"] = "test-scim-routes-secret";
process.env["NODE_ENV"] = "test";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["SCIM_TOKEN"] = "idp-bearer-token-strong-01";
delete process.env["OIDC_ISSUER_URL"];

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  const { __resetScim } = await import("../lib/scim");
  __resetScim();
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const scim = (path: string, init?: RequestInit) =>
  fetch(`${base}/api/scim/v2${path}`, {
    ...init,
    headers: { authorization: "Bearer idp-bearer-token-strong-01", "content-type": "application/json", ...(init?.headers ?? {}) },
  });

test("rejects a missing/invalid bearer token with 401", async () => {
  const res = await fetch(`${base}/api/scim/v2/Users`, { headers: { authorization: "Bearer nope" } });
  assert.equal(res.status, 401);
});

test("rejects a request with no Authorization header at all → 401", async () => {
  // Exercises the `req.headers.authorization ?? ""` default (no header ⇒ empty ⇒ invalid token).
  const res = await fetch(`${base}/api/scim/v2/Users`);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), "Bearer");
});

test("rejects a non-Bearer Authorization scheme → 401", async () => {
  // Exercises the `startsWith("Bearer ") ? … : ""` else arm — a Basic header yields no token.
  const res = await fetch(`${base}/api/scim/v2/Users`, { headers: { authorization: "Basic aWRwOnNlY3JldA==" } });
  assert.equal(res.status, 401);
});

test("ServiceProviderConfig advertises patch + filter support", async () => {
  const res = await scim("/ServiceProviderConfig");
  assert.equal(res.status, 200);
  const cfg = await res.json() as any;
  assert.equal(cfg.patch.supported, true);
  assert.equal(cfg.filter.supported, true);
});

test("create → get → filter → deprovision (PATCH active=false) → delete", async () => {
  // Create
  const created = await scim("/Users", { method: "POST", body: JSON.stringify({ userName: "grace@corp.com", active: true }) });
  assert.equal(created.status, 201);
  const user = await created.json() as any;
  assert.equal(user.userName, "grace@corp.com");
  assert.ok(user.id);

  // Filter
  const list = await (await scim(`/Users?filter=${encodeURIComponent('userName eq "grace@corp.com"')}`)).json() as any;
  assert.equal(list.totalResults, 1);
  assert.equal(list.Resources[0].id, user.id);

  // Deprovision via PATCH
  const patched = await scim(`/Users/${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json() as any).active, false);

  // Delete
  const del = await scim(`/Users/${user.id}`, { method: "DELETE" });
  assert.equal(del.status, 204);
  assert.equal((await scim(`/Users/${user.id}`)).status, 404);
});

test("create a group with a member", async () => {
  const u = await (await scim("/Users", { method: "POST", body: JSON.stringify({ userName: "heidi@corp.com" }) })).json() as any;
  const g = await scim("/Groups", { method: "POST", body: JSON.stringify({ displayName: "omni-admins", members: [{ value: u.id }] }) });
  assert.equal(g.status, 201);
  const group = await g.json() as any;
  assert.equal(group.displayName, "omni-admins");
  assert.equal(group.members[0].value, u.id);
});

test("POST /Users carries externalId, displayName + emails through to the created resource", async () => {
  // Exercises the three conditional-spread arms in the POST /Users handler (externalId/displayName/emails present).
  const emails = [{ value: "leo@corp.com", primary: true }];
  const created = await scim("/Users", {
    method: "POST",
    body: JSON.stringify({ userName: "leo@corp.com", externalId: "ext-leo", displayName: "Leo", emails }),
  });
  assert.equal(created.status, 201);
  const user = await created.json() as any;
  assert.equal(user.externalId, "ext-leo");
  assert.equal(user.displayName, "Leo");
  assert.equal(user.emails[0].value, "leo@corp.com");
});

test("POST /Groups carries externalId through to the created resource", async () => {
  // Exercises the externalId conditional-spread arm in the POST /Groups handler.
  const g = await scim("/Groups", { method: "POST", body: JSON.stringify({ displayName: "with-ext", externalId: "ext-grp" }) });
  assert.equal(g.status, 201);
  assert.equal((await g.json() as any).externalId, "ext-grp");
});

// ── Discovery endpoints (ResourceTypes / Schemas) ────────────────────────────
test("ResourceTypes and Schemas list the User + Group resources", async () => {
  const rt = await scim("/ResourceTypes");
  assert.equal(rt.status, 200);
  const rtBody = await rt.json() as any;
  assert.deepEqual(rtBody.Resources.map((r: any) => r.id).sort(), ["Group", "User"]);
  const sc = await scim("/Schemas");
  assert.equal(sc.status, 200);
  assert.equal((await sc.json() as any).totalResults, 2);
});

// ── User validation + replace + not-found branches ───────────────────────────
test("POST /Users without userName → 400", async () => {
  const r = await scim("/Users", { method: "POST", body: JSON.stringify({ active: true }) });
  assert.equal(r.status, 400);
});

test("PUT /Users/:id replaces an existing user; PUT an unknown id → 404", async () => {
  const u = await (await scim("/Users", { method: "POST", body: JSON.stringify({ userName: "ivan@corp.com", active: true }) })).json() as any;
  const replaced = await scim(`/Users/${u.id}`, { method: "PUT", body: JSON.stringify({ userName: "ivan@corp.com", active: false, displayName: "Ivan" }) });
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json() as any).active, false);
  assert.equal((await scim("/Users/no-such-user", { method: "PUT", body: JSON.stringify({ userName: "x" }) })).status, 404);
});

test("PATCH /Users/:id without Operations[] → 400; PATCH an unknown id → 404", async () => {
  const u = await (await scim("/Users", { method: "POST", body: JSON.stringify({ userName: "judy@corp.com" }) })).json() as any;
  assert.equal((await scim(`/Users/${u.id}`, { method: "PATCH", body: JSON.stringify({ schemas: [] }) })).status, 400);
  const goodOps = JSON.stringify({ Operations: [{ op: "replace", path: "active", value: false }] });
  assert.equal((await scim("/Users/no-such-user", { method: "PATCH", body: goodOps })).status, 404);
});

test("DELETE an unknown user → 404", async () => {
  assert.equal((await scim("/Users/no-such-user", { method: "DELETE" })).status, 404);
});

// ── Group get / replace / patch / delete + validation + not-found ────────────
test("GET /Groups lists groups; GET an unknown group → 404", async () => {
  await scim("/Groups", { method: "POST", body: JSON.stringify({ displayName: "list-probe" }) });
  const list = await scim("/Groups");
  assert.equal(list.status, 200);
  assert.ok((await list.json() as any).totalResults >= 1);
  assert.equal((await scim("/Groups/no-such-group")).status, 404);
});

test("POST /Groups without displayName → 400", async () => {
  assert.equal((await scim("/Groups", { method: "POST", body: JSON.stringify({ externalId: "e1" }) })).status, 400);
});

test("group lifecycle: create → GET → PUT replace → PATCH add member → DELETE", async () => {
  const g = await (await scim("/Groups", { method: "POST", body: JSON.stringify({ displayName: "lifecycle" }) })).json() as any;
  assert.equal((await scim(`/Groups/${g.id}`)).status, 200);

  const replaced = await scim(`/Groups/${g.id}`, { method: "PUT", body: JSON.stringify({ displayName: "lifecycle-renamed" }) });
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json() as any).displayName, "lifecycle-renamed");

  const u = await (await scim("/Users", { method: "POST", body: JSON.stringify({ userName: "kim@corp.com" }) })).json() as any;
  const patched = await scim(`/Groups/${g.id}`, { method: "PATCH", body: JSON.stringify({ Operations: [{ op: "add", path: "members", value: [{ value: u.id }] }] }) });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json() as any).members[0].value, u.id);

  assert.equal((await scim(`/Groups/${g.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await scim(`/Groups/${g.id}`)).status, 404);
});

test("group PUT/PATCH/DELETE on unknown ids → 404; PATCH without Operations → 400", async () => {
  assert.equal((await scim("/Groups/nope", { method: "PUT", body: JSON.stringify({ displayName: "x" }) })).status, 404);
  assert.equal((await scim("/Groups/nope", { method: "PATCH", body: JSON.stringify({ Operations: [] }) })).status, 404);
  assert.equal((await scim("/Groups/nope", { method: "DELETE" })).status, 404);
  const g = await (await scim("/Groups", { method: "POST", body: JSON.stringify({ displayName: "patch-shape" }) })).json() as any;
  assert.equal((await scim(`/Groups/${g.id}`, { method: "PATCH", body: JSON.stringify({ schemas: [] }) })).status, 400);
});

test("PUT /Users/:id validates the replace body shape (no userName → 400; bad emails → 400)", async () => {
  // Validation runs BEFORE the existence check, so a malformed body is 400 even for an unknown id.
  assert.equal((await scim("/Users/whatever", { method: "PUT", body: JSON.stringify({}) })).status, 400);
  assert.equal((await scim("/Users/whatever", { method: "PUT", body: JSON.stringify({ userName: "x", emails: "not-an-array" }) })).status, 400);
  assert.equal((await scim("/Users/whatever", { method: "PUT", body: JSON.stringify({ userName: "x", active: "yes" }) })).status, 400);
});

test("PUT /Groups/:id validates the replace body shape (no displayName → 400; bad members → 400)", async () => {
  assert.equal((await scim("/Groups/whatever", { method: "PUT", body: JSON.stringify({}) })).status, 400);
  assert.equal((await scim("/Groups/whatever", { method: "PUT", body: JSON.stringify({ displayName: "g", members: "nope" }) })).status, 400);
});
