import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS } from "./field-vocabulary";

/**
 * The field vocabulary is embedded from JSON (assets/fields.json). These tests pin the
 * registry's structural invariants — the same ones the gateway's reconcile path relies on.
 */

test("FIELD_REGISTRY is a non-empty array of well-formed descriptors", () => {
  assert.ok(Array.isArray(FIELD_REGISTRY));
  assert.ok(FIELD_REGISTRY.length > 0);
  for (const f of FIELD_REGISTRY) {
    assert.equal(typeof f.key, "string");
    assert.ok(f.key.length > 0);
    assert.equal(typeof f.label, "string");
    assert.equal(typeof f.type, "string");
  }
});

test("field keys are unique", () => {
  const keys = FIELD_REGISTRY.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate field keys would corrupt the reconcile lookup");
});

test("CANONICAL_FIELD_KEYS mirrors exactly the registry keys", () => {
  assert.equal(CANONICAL_FIELD_KEYS.size, FIELD_REGISTRY.length);
  for (const f of FIELD_REGISTRY) {
    assert.ok(CANONICAL_FIELD_KEYS.has(f.key), `${f.key} should be in the canonical key set`);
  }
  assert.ok(!CANONICAL_FIELD_KEYS.has("definitely-not-a-canonical-field"));
});
