import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/native.ts over the REAL app (roadmap X.1), behind the default-off `nativeHandoff` module. The demo
 * broker fronts an illustrative "demoboard" vendor, so the reference-level flow is exercisable end to end:
 * advertise surfaces → mint a host-allowlisted handoff URL → import a reference attachment. RBAC: read
 * viewer+, handoff/import contributor+.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "nativeHandoff";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "native-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

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

test("surfaces advertise what the connected backend fronts", async () => {
  const surfaces = (await req("/native/surfaces").then((x) => x.json())) as Array<{ kind: string; vendor: string; importMode: string }>;
  assert.ok(surfaces.some((s) => s.kind === "whiteboard" && s.vendor === "demoboard"));
  assert.ok(surfaces.every((s) => s.importMode === "reference"));
});

test("handoff mints a host-allowlisted vendor URL", async () => {
  const r = await req("/native/handoff", { method: "POST", body: { kind: "whiteboard", vendor: "demoboard", action: "create", contextRef: { projectId: "proj-001" } } });
  assert.equal(r.status, 200);
  const h = (await r.json()) as { url: string; handoffId: string };
  assert.match(h.url, /^https:\/\/example\.com\/omni\/whiteboard\//);
  assert.ok(h.handoffId);
});

test("a bad / non-allowlisted vendor is 400", async () => {
  assert.equal((await req("/native/handoff", { method: "POST", body: { kind: "whiteboard", vendor: "evil", action: "open" } })).status, 400);
  assert.equal((await req("/native/handoff", { method: "POST", body: { kind: "nope", vendor: "demoboard", action: "open" } })).status, 400);
});

test("import brings a reference back as an attachment on the target", async () => {
  const r = await req("/native/import", { method: "POST", body: { kind: "whiteboard", vendor: "demoboard", externalRef: "board-42", target: { projectId: "proj-001", issueId: "iss-1" } } });
  assert.equal(r.status, 201);
  const a = (await r.json()) as { taskId: string; url: string; filename: string };
  assert.equal(a.taskId, "iss-1");
  assert.match(a.url, /^https:\/\/example\.com\/omni\/whiteboard\/board-42$/);
  assert.equal(a.filename, "demoboard:whiteboard");
  // Import needs a correlator.
  assert.equal((await req("/native/import", { method: "POST", body: { kind: "whiteboard", vendor: "demoboard", target: { projectId: "proj-001" } } })).status, 400);
});

test("a viewer can read surfaces but can't hand off (contributor+)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], v: process.env["OIDC_VIEWER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  try {
    assert.equal((await req("/native/surfaces", { cookie: VIEWER })).status, 200);
    assert.equal((await req("/native/handoff", { method: "POST", body: { kind: "whiteboard", vendor: "demoboard", action: "open" }, cookie: VIEWER })).status, 403);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.v]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});
