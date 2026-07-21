import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMS, getForm, formCatalogue, formsForMethodology } from "./form-catalogue";

/** Shipped intake-form templates — the shared source of truth both apps consume. */
test("FORMS are well-formed templates: unique ids, ≥1 field, select fields have options", () => {
  const ids = new Set<string>();
  for (const f of FORMS) {
    assert.ok(f.id && f.label, `form needs id + label: ${JSON.stringify(f)}`);
    assert.ok(!ids.has(f.id), `duplicate form id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.fields.length > 0, `form ${f.id} needs fields`);
    assert.equal(f.target.kind, "issue");
    for (const field of f.fields) {
      assert.ok(field.key && field.label && field.type, `field needs key/label/type in ${f.id}`);
      if (field.type === "select") assert.ok((field.options ?? []).length > 0, `select ${field.key} needs options`);
    }
  }
});

test("templates ship UNtargeted (an admin binds the project)", () => {
  for (const f of FORMS) assert.equal(f.target.projectId, undefined, `template ${f.id} should ship untargeted`);
});

test("getForm / formCatalogue / formsForMethodology", () => {
  assert.equal(getForm("intake-request")?.label, "Work request");
  assert.equal(getForm("nope"), undefined);
  assert.equal(formCatalogue().length, FORMS.length);
  // A neutral ("*") form matches any methodology; a prince2-tagged one matches prince2 not scrum.
  assert.ok(formsForMethodology("scrum").some((f) => f.id === "intake-request"));
  assert.ok(formsForMethodology("prince2").some((f) => f.id === "change-request"));
  assert.ok(!formsForMethodology("scrum").some((f) => f.id === "change-request"));
});
