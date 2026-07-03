import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Route happy-path coverage — drives the REAL Express app (demo broker) over HTTP
 * with an admin session, exercising the read + write routes end to end. The
 * security suite proves the gates HOLD; this proves the routes WORK (and lifts
 * coverage of projects/programmes/portfolio/history routing + serialisation).
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
// No OIDC_ISSUER_URL → demo auth → sessions are admin (so writes are allowed). That, plus
// rate-limiting deliberately off, are now CRITICAL boot-refusing findings by default — opt
// out for this harness only (this "production" is a test convenience, not a real deployment).
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = signedSessionCookie({ sub: "admin-1", email: "a@b.c", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie: ADMIN } });
const json = async (path: string) => {
  const r = await get(path);
  assert.equal(r.status, 200, `${path} → ${r.status}`);
  return r.json();
};

test("portfolio read routes return their shapes", async () => {
  const projects = (await json("/api/projects")) as Array<{ id: string }>;
  assert.ok(Array.isArray(projects) && projects.length > 0);
  const pid = projects[0]!.id;

  assert.ok(Array.isArray(await json(`/api/projects/${pid}/issues`)));
  const summary = (await json(`/api/projects/${pid}/summary`)) as { projectId: string };
  assert.equal(summary.projectId, pid);
  assert.ok(Array.isArray(await json("/api/activity")));
  assert.ok(Array.isArray(await json("/api/resources")));
  assert.ok(Array.isArray(await json(`/api/projects/${pid}/members`)));
  assert.ok(Array.isArray(await json(`/api/projects/${pid}/raid`)));
  assert.ok(Array.isArray(await json(`/api/projects/${pid}/history`)));
  assert.ok(Array.isArray(await json("/api/notifications")));
  assert.ok(Array.isArray(await json("/api/portfolio/health")));
  assert.equal(typeof await json(`/api/projects/${pid}/capacity`), "object");
  assert.equal(typeof await json(`/api/projects/${pid}/financials`), "object");
  await get(`/api/projects/${pid}/baseline`); // 200 or null body — just exercise it
  const fx = (await json("/api/fx-rates")) as { base: string };
  assert.equal(typeof fx.base, "string");
});

test("programmes routes (derived rollup) respond", async () => {
  const programmes = (await json("/api/programmes")) as Array<{ id: string }>;
  assert.ok(Array.isArray(programmes));
  if (programmes.length) {
    const detail = (await json(`/api/programmes/${programmes[0]!.id}`)) as { projects: unknown[] };
    assert.ok(Array.isArray(detail.projects));
  }
});

test("issue write lifecycle: create → update → add item → delete", async () => {
  const projects = (await json("/api/projects")) as Array<{ id: string }>;
  const pid = projects[0]!.id;

  const created = await fetch(`${base}/api/projects/${pid}/issues`, {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ title: "Coverage task", estimateHours: 5 }),
  });
  assert.equal(created.status, 201);
  const issue = (await created.json()) as { id: string; version?: number };
  assert.ok(issue.id);

  const updated = await fetch(`${base}/api/projects/${pid}/issues/${issue.id}`, {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ status: "in_progress", expectedVersion: issue.version }),
  });
  assert.equal(updated.status, 200);

  const item = await fetch(`${base}/api/projects/${pid}/issues/${issue.id}/items`, {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ kind: "note", content: "a coverage note" }),
  });
  assert.ok(item.status === 201 || item.status === 200);
  assert.ok(Array.isArray(await json(`/api/projects/${pid}/issues/${issue.id}/items`)));

  const del = await fetch(`${base}/api/projects/${pid}/issues/${issue.id}`, {
    method: "DELETE",
    headers: { cookie: ADMIN },
  });
  assert.equal(del.status, 204);
});

test("raid create + project create/update round-trip", async () => {
  const projects = (await json("/api/projects")) as Array<{ id: string }>;
  const pid = projects[0]!.id;

  const raid = await fetch(`${base}/api/projects/${pid}/raid`, {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ type: "risk", title: "Coverage risk", severity: "medium" }),
  });
  assert.ok(raid.status === 201 || raid.status === 200);

  const proj = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ name: "Coverage Project", identifier: "COV" }),
  });
  assert.equal(proj.status, 201);
  const created = (await proj.json()) as { id: string };
  const patched = await fetch(`${base}/api/projects/${created.id}`, {
    method: "PATCH",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ name: "Coverage Project (renamed)" }),
  });
  assert.equal(patched.status, 200);
});

test("invalid bodies are rejected with 400", async () => {
  const projects = (await json("/api/projects")) as Array<{ id: string }>;
  const pid = projects[0]!.id;
  const bad = await fetch(`${base}/api/projects/${pid}/issues`, {
    method: "POST",
    headers: { cookie: ADMIN, "content-type": "application/json" },
    body: JSON.stringify({ notTitle: "missing required title" }),
  });
  assert.equal(bad.status, 400);
});
