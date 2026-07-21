import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/system-defs.ts over the REAL app (roadmap X.11). The system defaults store is read-only to customers;
 * the ONLY runtime update is this admin-gated + step-up route, which re-applies OUR bundled catalogue (no def
 * payload accepted) in one shot. We cover: admin apply, the summary read, and the RBAC/step-up gates.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "system-defs-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"], stepUpAt: Date.now() });
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, { method: o.method ?? "GET", headers: { cookie: o.cookie ?? ADMIN } });

test("an admin (with step-up) applies OUR bundled defaults in one shot", async () => {
  const r = await req("/admin/system-defs/apply", { method: "POST" });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { applied: boolean; count: number };
  assert.equal(body.applied, true);
  assert.ok(body.count > 0);

  // The summary read reflects what was installed, by kind.
  const summary = (await req("/admin/system-defs").then((x) => x.json())) as { total: number; byKind: Record<string, number> };
  assert.equal(summary.total, body.count);
  assert.ok(summary.byKind["report"]! > 0);
  assert.ok(summary.byKind["dashboard"]! > 0);
});

test("a non-admin can't apply or read the system defaults", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], c: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    assert.equal((await req("/admin/system-defs/apply", { method: "POST", cookie: CONTRIBUTOR })).status, 403);
    assert.equal((await req("/admin/system-defs", { cookie: CONTRIBUTOR })).status, 403);
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("apply requires step-up (a stale admin session is refused)", async () => {
  const stale = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
  const r = await req("/admin/system-defs/apply", { method: "POST", cookie: stale });
  assert.ok(r.status === 401 || r.status === 403, `stale step-up refused (got ${r.status})`);
});
