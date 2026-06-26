import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileFields,
  relationships,
  inferRelationshipCandidates,
  validateEntityInput,
  CANONICAL_FIELD_KEYS,
  FIELD_REGISTRY,
  type EnumeratedField,
  type FieldDescriptor,
} from "./field-registry";
import { FIELD_KEYS } from "./capabilities";
import { DemoBroker } from "../broker/demo";

test("FIELD_KEYS is derived from the registry (single source of truth)", () => {
  assert.deepEqual([...FIELD_KEYS], FIELD_REGISTRY.map((f) => f.key));
});

test("reconcileFields: classifies known vs new (to-be-registered) fields", () => {
  const enumerated: EnumeratedField[] = [
    { key: "title" },
    { key: "dueDate" },
    { key: "tshirtSize" }, // a backend field the seam doesn't know yet
    { key: "blockedReason" }, // another
  ];
  const r = reconcileFields(enumerated);
  assert.deepEqual(r.known.sort(), ["dueDate", "title"]);
  assert.deepEqual(r.unknown.sort(), ["blockedReason", "tshirtSize"]);
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

test("relationships(): programmeId is a belongs_to edge to programme", () => {
  const rels = relationships();
  assert.ok(rels.some((r) => r.field === "programmeId" && r.references === "programme" && r.kind === "belongs_to"));
});

test("inferRelationshipCandidates: explicit references and <entity>Id heuristics", () => {
  const enumerated: EnumeratedField[] = [
    { key: "epicId", references: "epic" }, // explicit
    { key: "projectRef" }, // heuristic → project
    { key: "title" }, // canonical, skipped
    { key: "color" }, // no relationship
  ];
  const cands = inferRelationshipCandidates(enumerated, ["epic", "project", "programme"]);
  assert.deepEqual(
    cands.sort((a, b) => a.field.localeCompare(b.field)),
    [
      { field: "epicId", references: "epic", kind: "belongs_to" },
      { field: "projectRef", references: "project", kind: "belongs_to" },
    ],
  );
});

test("validateEntityInput: required fields and referential integrity", () => {
  const descriptors: FieldDescriptor[] = [
    { key: "title", label: "Title", type: "string", required: true },
    { key: "programmeId", label: "Programme", type: "reference", references: "programme" },
  ];
  const knownRefs = { programme: new Set(["prog-1", "prog-2"]) };

  // missing required title + dangling programme reference
  const bad = validateEntityInput({ programmeId: "prog-X" }, descriptors, knownRefs);
  assert.deepEqual(bad.map((e) => e.field).sort(), ["programmeId", "title"]);

  // valid
  const ok = validateEntityInput({ title: "Apollo", programmeId: "prog-1" }, descriptors, knownRefs);
  assert.deepEqual(ok, []);

  // a reference is optional when not required and left empty
  const emptyRefOk = validateEntityInput({ title: "Apollo" }, descriptors, knownRefs);
  assert.deepEqual(emptyRefOk, []);
});
