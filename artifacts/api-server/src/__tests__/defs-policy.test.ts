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

test("policy defaults: user→contributor, project→manager, org→pmoOrAdmin", async () => {
  const { policy } = (await req("/defs/policy", { cookie: MANAGER }).then((x) => x.json())) as { policy: Record<string, string> };
  assert.deepEqual(policy, { user: "contributor", project: "manager", org: "pmoOrAdmin" });
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
