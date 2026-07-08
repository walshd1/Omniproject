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

test("fingerprint tolerates a non-Error value (no name/message/stack)", () => {
  assert.match(fingerprint(null), /^[0-9a-f]{12}$/);
  assert.match(fingerprint({}), /^[0-9a-f]{12}$/);
  assert.match(fingerprint("just a string"), /^[0-9a-f]{12}$/);
});

test("an exposed 4xx http-error surfaces its own message and status (client_error, no bug metric)", () => {
  resetRuntimeMetrics();
  const res = fakeRes();
  const err = { status: 413, expose: true, message: "request entity too large" };
  errorHandler(err, req() as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 413);
  assert.equal((res.body as { error: string }).error, "request entity too large");
  // A 4xx is a client error, not a bug → the unhandled-error metric stays at 0.
  assert.match(formatPrometheus(runtimeMetrics()), /omniproject_unhandled_errors_total 0/);
});

test("a NON-exposed 4xx uses a generic 'Bad request' message", () => {
  const res = fakeRes();
  errorHandler({ statusCode: 400, message: "leaky parser detail" }, req() as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { error: string }).error, "Bad request");
  assert.ok(!JSON.stringify(res.body).includes("leaky parser detail"));
});

test("an out-of-range status falls back to a 500 bug response", () => {
  const res = fakeRes();
  errorHandler({ status: 200, message: "not an error status" }, req() as never, res as never, (() => {}) as never);
  assert.equal(res.statusCode, 500);
  assert.equal((res.body as { error: string }).error, "Internal server error");
});

test("uses the request-bound logger when present (req.log)", () => {
  const res = fakeRes();
  let warned = false;
  const reqWithLog = { ...req(), log: { error() {}, warn() { warned = true; } } };
  errorHandler({ status: 400, expose: true, message: "bad" }, reqWithLog as never, res as never, (() => {}) as never);
  assert.equal(warned, true);
});
