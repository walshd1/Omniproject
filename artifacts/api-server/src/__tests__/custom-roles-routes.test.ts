import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/custom-roles.ts over the REAL app (roadmap X.6) — admin-only CRUD for custom roles + permission
 * sets, persisted org-wide in the sealed store. Admin defines them; a manager can't; a bad config is 400.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["SECURITY_STRICT"] = "off";
process.env["OIDC_ISSUER_URL"] = "https://idp.example";
process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "custom-roles-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
const MANAGER = cookie({ sub: "m", email: "mia@x.io", roles: ["omni-managers"] });
// A user whose ONLY IdP group is "finance" — unmapped to any fixed role, so it resolves via a custom role.
const FINANCE = cookie({ sub: "f", email: "fin@x.io", roles: ["finance"] });

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

test("GET returns the config + the base-role and capability pickers (admin)", async () => {
  const r = await req("/admin/custom-roles", { cookie: ADMIN });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { config: unknown; baseRoles: string[]; capabilities: unknown[] };
  assert.deepEqual(body.config, { permissionSets: [], customRoles: [] });
  assert.ok(body.baseRoles.includes("contributor"));
  assert.ok(!body.baseRoles.includes("guest"));
  assert.ok(Array.isArray(body.capabilities) && body.capabilities.length > 0);
});

test("PUT persists a valid config; a bad config is 400", async () => {
  const cap = (await req("/admin/custom-roles", { cookie: ADMIN }).then((x) => x.json())) as { capabilities: { id: string }[] };
  const capId = cap.capabilities[0]!.id;
  const good = {
    permissionSets: [{ id: "pack", label: "Pack", capabilities: [capId] }],
    customRoles: [{ id: "finance-analyst", label: "Finance Analyst", baseRole: "manager", permissionSetIds: ["pack"], groups: ["finance"] }],
  };
  const put = await req("/admin/custom-roles", { method: "PUT", body: good, cookie: ADMIN });
  assert.equal(put.status, 200);
  assert.equal(((await put.json()) as { config: { customRoles: unknown[] } }).config.customRoles.length, 1);
  // Persisted.
  const after = (await req("/admin/custom-roles", { cookie: ADMIN }).then((x) => x.json())) as { config: { customRoles: { id: string }[] } };
  assert.equal(after.config.customRoles[0]!.id, "finance-analyst");
  // A custom role colliding with a built-in role is 400.
  assert.equal((await req("/admin/custom-roles", { method: "PUT", body: { customRoles: [{ id: "admin", label: "X", baseRole: "manager" }] }, cookie: ADMIN })).status, 400);
});

test("a manager cannot read or write custom roles (admin-only)", async () => {
  assert.equal((await req("/admin/custom-roles", { cookie: MANAGER })).status, 403);
  assert.equal((await req("/admin/custom-roles", { method: "PUT", body: {}, cookie: MANAGER })).status, 403);
});

test("resolution: a finance-group user is lifted to the custom role's base (manager)", async () => {
  // The prior test persisted finance-analyst (base manager, groups ["finance"]). A finance-only user has no
  // fixed-role claim, so this role comes ENTIRELY from the custom role resolving to its base.
  const me = (await req("/auth/me", { cookie: FINANCE }).then((x) => x.json())) as { role: string };
  assert.equal(me.role, "manager");
});
