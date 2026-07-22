import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/studio.ts over the REAL app (roadmap X.2), behind the default-off `studio` module. The studio only
 * GENERATES + validates; it's governed like every AI surface — the active provider capability + the
 * `ai-authoring` capability are OFF by default, so a generate request is stopped at the governance gate (403)
 * before any provider call. We assert the gate + input validation + the status endpoint, mirroring
 * ai-routes.test's convention (no fetch-mock for aiChat; assert the gate).
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "studio";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
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
    headers: { cookie: o.cookie ?? CONTRIBUTOR, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("status reports no AI provider configured", async () => {
  const r = await req("/studio/status");
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { available: boolean }).available, false);
});

test("a generate request is blocked at the governance gate (AI off by default)", async () => {
  const r = await req("/studio/primitive", { method: "POST", body: { description: "a grouped column chart" } });
  assert.equal(r.status, 403);
});

test("a bad body is 400 (empty description)", async () => {
  assert.equal((await req("/studio/primitive", { method: "POST", body: { description: "" } })).status, 400);
});

test("a viewer cannot reach the studio (contributor+)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], v: process.env["OIDC_VIEWER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  try {
    const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });
    assert.equal((await req("/studio/primitive", { method: "POST", body: { description: "x" }, cookie: VIEWER })).status, 403);
    assert.equal((await req("/studio/status", { cookie: VIEWER })).status, 403);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.v]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});
