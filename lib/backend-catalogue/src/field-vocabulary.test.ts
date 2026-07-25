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

test("options only appear on enum fields, and each is a non-empty id-safe allow-list", () => {
  const idSafe = /^[a-z0-9][a-z0-9_]*$/;
  for (const f of FIELD_REGISTRY) {
    if (f.options === undefined) continue;
    assert.equal(f.type, "enum", `${f.key} declares options but is type "${f.type}" (options are only meaningful for enum)`);
    assert.ok(Array.isArray(f.options) && f.options.length > 0, `${f.key} options must be a non-empty array`);
    assert.equal(new Set(f.options).size, f.options.length, `${f.key} options must be unique`);
    for (const o of f.options) assert.ok(idSafe.test(o), `${f.key} option "${o}" must be lower_snake_case id-safe`);
  }
});

test("the finance enum fields declare their canonical value sets (options threaded through)", () => {
  // The value sets the finance business rules key off (period closed/locked, journal posted, 3-way matched,
  // AP approved) must be present so a UI element bound to these fields inherits the allow-list.
  const expect: Record<string, string[]> = {
    periodStatus: ["open", "closed", "locked"],
    journalPostingStatus: ["draft", "posted", "reversed"],
    matchStatus: ["unmatched", "partially_matched", "matched", "exception"],
    approvalState: ["draft", "pending", "approved", "rejected"],
    accountType: ["asset", "liability", "equity", "revenue", "expense"],
  };
  for (const [key, opts] of Object.entries(expect)) {
    const f = FIELD_REGISTRY.find((d) => d.key === key);
    assert.ok(f, `${key} should exist in the registry`);
    assert.deepEqual(f!.options, opts, `${key} should declare its canonical options`);
  }
});

test("CANONICAL_FIELD_KEYS mirrors exactly the registry keys", () => {
  assert.equal(CANONICAL_FIELD_KEYS.size, FIELD_REGISTRY.length);
  for (const f of FIELD_REGISTRY) {
    assert.ok(CANONICAL_FIELD_KEYS.has(f.key), `${f.key} should be in the canonical key set`);
  }
  assert.ok(!CANONICAL_FIELD_KEYS.has("definitely-not-a-canonical-field"));
});
