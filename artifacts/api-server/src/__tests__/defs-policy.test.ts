import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The definition SCOPE POLICY (roadmap X.3) — the admin-configurable "who may write at each scope" gate.
 * Defaults: user → contributor, project → manager, org → pmoOrAdmin. This file forces real claim→role
 * resolution (OIDC env) so the gates actually bite, and verifies an admin can relax a scope's gate.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "defImporter";
process.env["SECURITY_STRICT"] = "off";
process.env["OIDC_ISSUER_URL"] = "https://idp.example";
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_PMO_ROLES"] = "omni-pmos";
process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
process.env["OIDC_PROGRAMME_MANAGER_ROLES"] = "omni-progleads";
process.env["OIDC_PROGRAMME_GROUP_PREFIX"] = "programme:";
process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "defs-policy-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
// pmo/admin authorities are only granted with strong-auth proof (amr) — a plain claim alone yields manager.
const ADMIN = cookie({ sub: "a", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
const PMO = cookie({ sub: "p", email: "pmo@x.io", roles: ["omni-pmos"], amr: ["hwk"] });
const MANAGER = cookie({ sub: "m", email: "mia@x.io", roles: ["omni-managers"] });
// A programme lead who OWNS programme "alpha" (group `programme:alpha`) — programmeManager rung + that scope.
const PROG_LEAD = cookie({ sub: "pl", email: "pat@x.io", roles: ["omni-progleads", "programme:alpha"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; body?: unknown; cookie: string }) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

const PRIMITIVE = {
  id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
  description: "compare series", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "rows" }],
};
const orgWrite = (c: string) => req("/defs", { method: "POST", body: { kind: "primitive", storage: "org", name: "Org chart", payload: PRIMITIVE }, cookie: c });

test("policy defaults: user→contributor, project→manager, programme→programmeManager, org→pmoOrAdmin", async () => {
  const { policy } = (await req("/defs/policy", { cookie: MANAGER }).then((x) => x.json())) as { policy: Record<string, string> };
  assert.deepEqual(policy, { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" });
});

test("by default a manager can't write org (pmoOrAdmin) but a PMO and an admin can", async () => {
  assert.equal((await orgWrite(MANAGER)).status, 403);
  assert.equal((await orgWrite(PMO)).status, 201);
  assert.equal((await orgWrite(ADMIN)).status, 201);
});

test("only an admin can change the policy", async () => {
  assert.equal((await req("/defs/policy", { method: "PUT", body: { org: "manager" }, cookie: MANAGER })).status, 403);
  assert.equal((await req("/defs/policy", { method: "PUT", body: { org: "bogus" }, cookie: ADMIN })).status, 400);
});

test("an admin can relax the org gate so a manager may then write org-wide", async () => {
  const put = await req("/defs/policy", { method: "PUT", body: { org: "manager" }, cookie: ADMIN });
  assert.equal(put.status, 200);
  assert.equal(((await put.json()) as { policy: { org: string } }).policy.org, "manager");
  // Now a manager satisfies the org gate.
  assert.equal((await orgWrite(MANAGER)).status, 201);
});

// ── Programme write path (roadmap X.12 / X.13) — the programmeManager rung AND that programme's row-scope ──
const progWrite = (c: string, programmeId: string) =>
  req("/defs", { method: "POST", body: { kind: "primitive", storage: "programme", programmeId, name: "Prog chart", payload: PRIMITIVE }, cookie: c });

test("a programme def needs the programmeManager gate: a plain manager is refused, a programme lead is not", async () => {
  // A plain manager lacks the programmeManager rung → 403 at the gate.
  assert.equal((await progWrite(MANAGER, "alpha")).status, 403);
  // The programme lead who owns "alpha" writes it — 201.
  assert.equal((await progWrite(PROG_LEAD, "alpha")).status, 201);
});

test("a programme write is confined to a programme the caller owns (scoping)", async () => {
  // The alpha lead can't write to "beta" (not in their scope) — 403, so the change can't leak sideways.
  assert.equal((await progWrite(PROG_LEAD, "beta")).status, 403);
  // pmo/admin are all-scope, so they can write any programme.
  assert.equal((await progWrite(PMO, "beta")).status, 201);
});

test("a programmeId is required for a programme write", async () => {
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "programme", name: "x", payload: PRIMITIVE }, cookie: PROG_LEAD })).status, 400);
});

test("a written programme def is listable + resolvable to an in-scope caller via ?programmeId", async () => {
  const created = (await progWrite(PROG_LEAD, "alpha").then((x) => x.json())) as { id: string };
  assert.match(created.id, /^programme~alpha~/);
  // GET by id (the caller owns the programme) returns it.
  assert.equal((await req(`/defs/${encodeURIComponent(created.id)}`, { cookie: PROG_LEAD })).status, 200);
  // It shows up in the caller's list + resolved seam only when ?programmeId is in scope.
  const list = (await req("/defs?programmeId=alpha", { cookie: PROG_LEAD }).then((x) => x.json())) as Array<{ id: string }>;
  assert.ok(list.some((m) => m.id === created.id));
  const resolved = (await req("/defs/resolved/primitive?programmeId=alpha", { cookie: PROG_LEAD }).then((x) => x.json())) as Array<{ id: string }>;
  assert.ok(resolved.some((r) => r.id === created.id));
  // An out-of-scope caller (owns only alpha) asking for beta sees no beta programme rows.
  const beta = (await req("/defs?programmeId=beta", { cookie: PROG_LEAD }).then((x) => x.json())) as Array<{ id: string }>;
  assert.ok(!beta.some((m) => m.id.startsWith("programme~beta~")));
});
