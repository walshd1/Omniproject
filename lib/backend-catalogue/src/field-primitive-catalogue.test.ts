import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldPrimitive, fieldPrimitiveCatalogue, validateFieldInstance, validateFormFields } from "./field-primitive-catalogue";
import { formCatalogue, FORM_FIELD_TYPES } from "./form-catalogue";

/**
 * `field` as a ROOT primitive with a child per form-field type. The load-bearing guard: the per-field validator
 * accepts every shipped form's fields (no import/submission regression), and the `mapTo` allow-list — now a floor
 * on the root — actually bites.
 */

test("field is the permissive ROOT (no floors); form-field carries the mapTo floor; types extend form-field", () => {
  const root = fieldPrimitive("field")!;
  assert.equal(root.extends, undefined);
  assert.equal(root.abstract, true);                 // never used raw
  assert.ok(!root.constraints || root.constraints.length === 0, "the root imposes no restrictive floors");
  const formField = fieldPrimitive("form-field")!;
  assert.equal(formField.extends, "field");
  assert.equal(formField.abstract, true);
  const floor = formField.constraints!.find((c) => c.id === "form-field-target")!;
  assert.equal(floor.kind, "floor");
  assert.equal(floor.type, "enum");
  for (const t of FORM_FIELD_TYPES) assert.equal(fieldPrimitive(t)!.extends, "form-field", `${t} extends form-field`);
});

test("abstract ancestors may never be used raw as a field type", () => {
  assert.ok(validateFieldInstance({ key: "a", label: "A", type: "field", mapTo: "title" }).length >= 1);
  assert.ok(validateFieldInstance({ key: "a", label: "A", type: "form-field", mapTo: "title" }).length >= 1);
});

test("every shipped form's fields validate as field-primitive instances (no regression)", () => {
  for (const form of formCatalogue()) {
    assert.deepEqual(validateFormFields(form.fields), [], `shipped form "${form.id}" fields must validate`);
  }
  assert.equal(fieldPrimitiveCatalogue().length, FORM_FIELD_TYPES.length + 2); // root + form-field + one per type
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
