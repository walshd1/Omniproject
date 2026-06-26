import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileFields, CANONICAL_FIELD_KEYS, FIELD_REGISTRY, type EnumeratedField } from "./field-registry";
import { FIELD_KEYS } from "./capabilities";
import { DemoBroker } from "../broker/demo";

test("FIELD_KEYS is derived from the registry (single source of truth)", () => {
  assert.deepEqual([...FIELD_KEYS], FIELD_REGISTRY.map((f) => f.key));
});

test("reconcileFields: classifies known vs new (to-be-registered) fields", () => {
  const enumerated: EnumeratedField[] = [
    { key: "title" },
    { key: "dueDate" },
    { key: "sprint" }, // a backend field the seam doesn't know yet
    { key: "epicLink" }, // another
  ];
  const r = reconcileFields(enumerated);
  assert.deepEqual(r.known.sort(), ["dueDate", "title"]);
  assert.deepEqual(r.unknown.sort(), ["epicLink", "sprint"]);
  // canonical fields not enumerated are reported as missing (gated off, not an error)
  assert.ok(r.missing.includes("storyPoints"));
  assert.ok(!r.missing.includes("title"));
});

test("reconcileFields: ignores blanks and dedupes", () => {
  const r = reconcileFields([{ key: "title" }, { key: "title" }, { key: "" }]);
  assert.deepEqual(r.known, ["title"]);
  assert.equal(r.unknown.length, 0);
});

test("a backend exposing only the canonical set has no unknown fields", () => {
  const enumerated = [...CANONICAL_FIELD_KEYS].map((key) => ({ key }));
  const r = reconcileFields(enumerated);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.missing.length, 0);
});

test("DemoBroker.describeFields enumerates the canonical registry (all known)", async () => {
  const enumerated = await new DemoBroker().describeFields();
  const r = reconcileFields(enumerated);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.known.length, FIELD_REGISTRY.length);
});
