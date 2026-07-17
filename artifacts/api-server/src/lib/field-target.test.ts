import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFieldTarget, sanitizeFieldRef, sanitizeHomeId, targetKey, sameHome,
  BUILTIN_BROKER, SIDECAR_BACKEND, BUILTIN_HOME, FieldTargetError,
} from "./field-target";

/**
 * Field-target addressing (§4.6): every field resolves to EXACTLY ONE (broker, backend). A field with no home
 * falls back to the built-in broker + sidecar backend — the all-in-one self-hosted default.
 */

test("a bare field name inherits the built-in broker + sidecar backend (the all-in-one fallback)", () => {
  const t = resolveFieldTarget("budget");
  assert.deepEqual(t, { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "budget" });
});

test("a bare field name inherits the mapping's declared home when one is given", () => {
  const home = { broker: "n8n", backend: "openproject" };
  assert.deepEqual(resolveFieldTarget("costBudget", home), { broker: "n8n", backend: "openproject", field: "costBudget" });
});

test("a partial address inherits only the missing half — a field always names exactly one broker + backend", () => {
  const home = { broker: "n8n", backend: "openproject" };
  // Only backend given → broker inherited from home.
  assert.deepEqual(resolveFieldTarget({ backend: "sap", field: "ACDOCA_BUDGET" }, home), { broker: "n8n", backend: "sap", field: "ACDOCA_BUDGET" });
  // Only broker given → backend inherited.
  assert.deepEqual(resolveFieldTarget({ broker: "make", field: "x" }, home), { broker: "make", backend: "openproject", field: "x" });
});

test("targetKey buckets by (broker, backend); sameHome compares them", () => {
  assert.equal(targetKey({ broker: "a", backend: "b" }), targetKey({ broker: "a", backend: "b" }));
  assert.notEqual(targetKey({ broker: "a", backend: "b" }), targetKey({ broker: "a", backend: "c" }));
  assert.ok(sameHome(BUILTIN_HOME, { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND }));
  assert.ok(!sameHome(BUILTIN_HOME, { broker: "n8n", backend: "sap" }));
});

test("sanitizeFieldRef accepts a bare name or a { broker?, backend?, field } address", () => {
  assert.equal(sanitizeFieldRef("budget", "costBudget"), "costBudget");
  assert.deepEqual(sanitizeFieldRef("budget", { backend: "sap", field: "ACDOCA" }), { backend: "sap", field: "ACDOCA" });
  assert.deepEqual(sanitizeFieldRef("budget", { broker: "n8n", backend: "op", field: "cb" }), { broker: "n8n", backend: "op", field: "cb" });
  assert.equal(sanitizeFieldRef("budget", undefined), undefined);
});

test("sanitizeFieldRef rejects unsafe field/broker/backend ids and bad shapes", () => {
  assert.throws(() => sanitizeFieldRef("budget", "__proto__"), FieldTargetError);
  assert.throws(() => sanitizeFieldRef("budget", { field: "__proto__" }), FieldTargetError);
  assert.throws(() => sanitizeFieldRef("budget", { broker: "__proto__", field: "x" }), FieldTargetError);
  assert.throws(() => sanitizeFieldRef("budget", { field: "" }), FieldTargetError);
  assert.throws(() => sanitizeFieldRef("budget", 42), FieldTargetError);
});

test("sanitizeHomeId validates a bare broker/backend id", () => {
  assert.equal(sanitizeHomeId("broker", "n8n"), "n8n");
  assert.equal(sanitizeHomeId("broker", undefined), undefined);
  assert.throws(() => sanitizeHomeId("broker", "__proto__"), FieldTargetError);
});
