import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/timer.ts over the REAL app (roadmap 3.3). A live per-user timer lives in the shared-state KV; start
 * / read / stop its lifecycle, and stopping returns the day-grained timesheet entry it produced. contributor+.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "timeTracking";
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const USER = cookie({ sub: "u1", name: "Uma", email: "uma@x.io", roles: ["omni-contributors"] });
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? USER, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("start → get → stop lifecycle produces a timesheet entry", async () => {
  assert.deepEqual(await (await req("/timer")).json(), { running: false }); // nothing running yet

  const started = await req("/timer/start", { method: "POST", body: { projectId: "P1", issueId: "OMNI-1", note: "design" } });
  assert.equal(started.status, 201);
  assert.equal(((await started.json()) as { running: boolean }).running, true);

  const running = (await (await req("/timer")).json()) as { running: boolean; timer: { projectId: string }; elapsedHours: number };
  assert.equal(running.running, true);
  assert.equal(running.timer.projectId, "P1");
  assert.ok(running.elapsedHours >= 0);

  const stopped = await req("/timer/stop", { method: "POST" });
  assert.equal(stopped.status, 200);
  const body = (await stopped.json()) as { running: boolean; entry: { projectId: string; issueId: string; hours: number; date: string } };
  assert.equal(body.running, false);
  assert.equal(body.entry.projectId, "P1");
  assert.equal(body.entry.issueId, "OMNI-1");
  assert.ok(body.entry.hours >= 0);
  assert.match(body.entry.date, /^\d{4}-\d{2}-\d{2}$/);

  // Stopping again is a 404 (nothing running).
  assert.equal((await req("/timer/stop", { method: "POST" })).status, 404);
});

test("a start without a projectId is rejected (400)", async () => {
  assert.equal((await req("/timer/start", { method: "POST", body: {} })).status, 400);
});

test("a viewer cannot use the timer (contributor+)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  try {
    assert.equal((await req("/timer/start", { method: "POST", body: { projectId: "P1" }, cookie: VIEWER })).status, 403);
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.view]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
