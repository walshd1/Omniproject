import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * routes/health.ts — liveness vs readiness over the REAL app. `BROKER_URL` is set
 * before the app boots so the active broker is a LIVE reference broker pointed at an
 * unreachable endpoint: liveness (/healthz) is dependency-free and always 200, while
 * readiness (/readyz) pings the backend and reports 503 when it can't be reached, so
 * the load balancer stops routing here without restarting the pod.
 */
process.env["BROKER_URL"] = "http://127.0.0.1:1/webhook"; // configured but unreachable → not ready
let h: { close: () => void; req: (p: string, o?: { headers?: Record<string, string> }) => Promise<Response> };

before(async () => {
  const { startHarness } = await import("./_harness");
  h = await startHarness();
});
after(() => h?.close());

test("GET /healthz is always 200 (dependency-free liveness)", async () => {
  const r = await h.req("/healthz");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { status: string };
  assert.equal(body.status, "ok");
});

test("GET /readyz reports 503 when the configured backend is unreachable", async () => {
  const r = await h.req("/readyz");
  assert.equal(r.status, 503);
  const body = (await r.json()) as { ready: boolean; kind: string };
  assert.equal(body.ready, false);
  assert.ok(typeof body.kind === "string");
});
