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
process.env["SCIM_TOKEN"] = "idp-bearer-token";
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
    headers: { authorization: "Bearer idp-bearer-token", "content-type": "application/json", ...(init?.headers ?? {}) },
  });

test("rejects a missing/invalid bearer token with 401", async () => {
  const res = await fetch(`${base}/api/scim/v2/Users`, { headers: { authorization: "Bearer nope" } });
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
