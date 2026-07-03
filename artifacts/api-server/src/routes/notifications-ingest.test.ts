import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Border validation for POST /api/notifications/ingest — the one route external
 * systems (n8n/tools) call with nothing but a shared secret standing between them
 * and the notify bus/webhook fan-out. Every field must be typed and bounded before
 * it's trusted, not just presence-checked with loose fallbacks.
 */
const SECRET = "test-ingest-secret";
process.env["NOTIFY_INGEST_SECRET"] = SECRET;
process.env["SESSION_SECRET"] = "test-session-secret-ingest";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

const ingest = (body: unknown) =>
  fetch(`${base}/api/notifications/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });

test("accepts a minimal valid notification (title only)", async () => {
  const res = await ingest({ notification: { title: "Build finished" } });
  assert.equal(res.status, 200);
});

test("accepts the full shape, including an explicit null body/projectId/issueId", async () => {
  const res = await ingest({
    notification: { id: "n1", kind: "warning", title: "Slow query", body: null, projectId: null, issueId: null },
    target: { role: "admin" },
  });
  assert.equal(res.status, 200);
});

test("rejects a missing notification.title", async () => {
  const res = await ingest({ notification: {} });
  assert.equal(res.status, 400);
});

test("rejects a non-string title", async () => {
  const res = await ingest({ notification: { title: 12345 } });
  assert.equal(res.status, 400);
});

test("rejects a title over the length cap (DoS-shaped payload)", async () => {
  const res = await ingest({ notification: { title: "x".repeat(501) } });
  assert.equal(res.status, 400);
});

test("rejects a body over the length cap", async () => {
  const res = await ingest({ notification: { title: "ok", body: "x".repeat(10_001) } });
  assert.equal(res.status, 400);
});

test("rejects an unknown-shaped target", async () => {
  const res = await ingest({ notification: { title: "ok" }, target: { sub: 12345 } });
  assert.equal(res.status, 400);
});

test("rejects a missing notification object entirely", async () => {
  const res = await ingest({});
  assert.equal(res.status, 400);
});

test("still 401s on a wrong ingest secret regardless of body shape", async () => {
  const res = await fetch(`${base}/api/notifications/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong-secret" },
    body: JSON.stringify({ notification: { title: "ok" } }),
  });
  assert.equal(res.status, 401);
});
