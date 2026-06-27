import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, errorHandler } from "./error-handler";
import { runtimeMetrics, resetRuntimeMetrics } from "./runtime-metrics";
import { formatPrometheus } from "./metrics";

function fakeRes() {
  const r: {
    statusCode: number; headersSent: boolean; body?: unknown; ended: boolean;
    status: (c: number) => typeof r; json: (b: unknown) => typeof r; end: () => typeof r;
  } = {
    statusCode: 200, headersSent: false, ended: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
  return r;
}
const req = () => ({ method: "GET", path: "/api/x", id: "req-1" });

test("fingerprint is deterministic for an error and differs by message/throw-site", () => {
  const a = new Error("boom");
  assert.equal(fingerprint(a), fingerprint(a)); // same error → same id (groups recurrences)
  assert.notEqual(fingerprint(a), fingerprint(new Error("different"))); // different failure → different id
  assert.match(fingerprint(a), /^[0-9a-f]{12}$/);
});

test("errorHandler returns a safe 500 with a reference, never a stack trace", () => {
  const res = fakeRes();
  errorHandler(new Error("ECONNRESET secret internal detail"), req() as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 500);
  const body = res.body as { error: string; reference: string };
  assert.equal(body.error, "Internal server error");
  assert.match(body.reference, /^[0-9a-f]{12}$/);
  // The raw message / stack must NOT be in the client body.
  assert.ok(!JSON.stringify(body).includes("secret internal detail"));
});

test("errorHandler increments the unhandled-error metric", () => {
  resetRuntimeMetrics();
  errorHandler(new Error("x"), req() as never, fakeRes() as never, (() => {}) as never);
  assert.match(formatPrometheus(runtimeMetrics()), /omniproject_unhandled_errors_total 1/);
});

test("when headers are already sent it just ends the response (no double-send)", () => {
  const res = fakeRes(); res.headersSent = true;
  errorHandler(new Error("late"), req() as never, res as never, (() => {}) as never);
  assert.equal(res.ended, true);
  assert.equal(res.body, undefined);
});
