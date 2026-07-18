import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldPrimitive, fieldPrimitiveCatalogue, validateFieldInstance, validateFormFields } from "./field-primitive-catalogue";
import { formCatalogue, FORM_FIELD_TYPES } from "./form-catalogue";

/**
 * `field` as a ROOT primitive with a child per form-field type. The load-bearing guard: the per-field validator
 * accepts every shipped form's fields (no import/submission regression), and the `mapTo` allow-list — now a floor
 * on the root — actually bites.
 */

test("field is a root; every FORM_FIELD_TYPE is a child that extends it", () => {
  assert.equal(fieldPrimitive("field")!.extends, undefined);
  for (const t of FORM_FIELD_TYPES) assert.equal(fieldPrimitive(t)!.extends, "field", `${t} extends field`);
  // The root carries the mapTo allow-list as a FLOOR.
  const floor = fieldPrimitive("field")!.constraints!.find((c) => c.id === "field-map-target")!;
  assert.equal(floor.kind, "floor");
  assert.equal(floor.type, "enum");
});

test("every shipped form's fields validate as field-primitive instances (no regression)", () => {
  for (const form of formCatalogue()) {
    assert.deepEqual(validateFormFields(form.fields), [], `shipped form "${form.id}" fields must validate`);
  }
  assert.ok(fieldPrimitiveCatalogue().length === FORM_FIELD_TYPES.length + 1); // root + one per type
});

test("per-field checks bite: unknown type, non-writable mapTo, missing options", () => {
  assert.ok(validateFieldInstance({ key: "a", label: "A", type: "wormhole", mapTo: "title" }).length >= 1);        // unknown type
  assert.ok(validateFieldInstance({ key: "a", label: "A", type: "text", mapTo: "secretColumn" }).length >= 1);     // mapTo not writable (the security floor)
  assert.ok(validateFieldInstance({ key: "a", label: "A", type: "select", mapTo: "priority" }).length >= 1);       // choice with no options
  assert.deepEqual(validateFieldInstance({ key: "a", label: "A", type: "select", mapTo: "priority", options: ["Lo", "Hi"] }), []);
  assert.deepEqual(validateFieldInstance({ key: "t", label: "T", type: "text", mapTo: "title" }), []);
});

test("the mapTo floor is the allow-list: a core writable target passes, an arbitrary field is rejected", () => {
  assert.deepEqual(validateFieldInstance({ key: "d", label: "D", type: "textarea", mapTo: "description" }), []);
  assert.ok(validateFieldInstance({ key: "x", label: "X", type: "text", mapTo: "__proto__" }).length >= 1);
});
