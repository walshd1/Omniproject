import test from "node:test";
import assert from "node:assert/strict";
import { primitiveSafetyErrors, isPrimitiveSafe, PRIMITIVE_LIMITS } from "./primitive-safety";
import type { PrimitiveDefShape } from "./primitive-schema";

/**
 * The extra guardrails a CUSTOMER-authored primitive must clear (on top of the shape check): bounded, and
 * render-safe (no injection vector in any text a renderer surfaces). Not an immutability check — an org may
 * override/extend a system primitive; these keep the def well-formed and injection-free.
 */

const base: PrimitiveDefShape = {
  id: "acme-chart", label: "Acme chart", category: "chart", extends: "chart",
  description: "an org's own chart", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "the rows" }],
};

test("a clean org primitive (extends a system one) is safe", () => {
  assert.deepEqual(primitiveSafetyErrors(base), []);
  assert.equal(isPrimitiveSafe(base), true);
});

test("a customer primitive with NO extends is rejected — it can't be a new root", () => {
  const { extends: _e, ...rootless } = base;
  assert.ok(primitiveSafetyErrors(rootless as PrimitiveDefShape).some((e) => /new root/.test(e)));
});

test("markup / script / data URLs in any text are rejected", () => {
  assert.ok(primitiveSafetyErrors({ ...base, label: "<b>x</b>" }).length);
  assert.ok(primitiveSafetyErrors({ ...base, description: "javascript:alert(1)" }).length);
  assert.ok(primitiveSafetyErrors({ ...base, params: [{ key: "d", label: "data:text/html,x", type: "string", required: false, description: "d" }] }).length);
  assert.ok(primitiveSafetyErrors({ ...base, params: [{ key: "t", label: "T", type: "enum", required: false, description: "d", options: ["ok", "<script>"] }] }).length);
});

test("bounds bite: too many params / options, over-long text", () => {
  const manyParams = { ...base, params: Array.from({ length: PRIMITIVE_LIMITS.maxParams + 1 }, (_v, i) => ({ key: `k${i}`, label: "L", type: "string" as const, required: false, description: "d" })) };
  assert.ok(primitiveSafetyErrors(manyParams).some((e) => /too many params/.test(e)));
  const longDesc = { ...base, description: "x".repeat(PRIMITIVE_LIMITS.maxDescription + 1) };
  assert.ok(primitiveSafetyErrors(longDesc).some((e) => /description is too long/.test(e)));
  const manyOptions = { ...base, params: [{ key: "o", label: "O", type: "enum" as const, required: false, description: "d", options: Array.from({ length: PRIMITIVE_LIMITS.maxOptions + 1 }, (_v, i) => `o${i}`) }] };
  assert.ok(primitiveSafetyErrors(manyOptions).some((e) => /too many options/.test(e)));
});
