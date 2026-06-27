import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { brokerReadiness, resetReadinessCache } from "./index";

beforeEach(() => resetReadinessCache());

test("the demo/in-process broker is always ready (no external dependency)", async () => {
  const r = await brokerReadiness();
  assert.equal(r.ready, true);
  assert.equal(r.kind, "demo");
  assert.equal(r.status, undefined); // no broker ping for an in-process backend
});

test("readiness is briefly cached (a probe loop can't hammer the broker)", async () => {
  const a = await brokerReadiness();
  const b = await brokerReadiness();
  assert.equal(a, b); // same cached object within the TTL
});
