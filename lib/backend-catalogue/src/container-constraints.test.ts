import { test } from "node:test";
import assert from "node:assert/strict";
import { kindRootConstraints, FORM_CONTAINER_CONSTRAINTS } from "./container-constraints";
import { evaluateConstraints } from "./def-constraints";
import { formCatalogue } from "./form-catalogue";

/**
 * Kind-root container constraints — the form container floors, expressed as data. The load-bearing guard here is
 * that EVERY shipped form already satisfies them (so lifting the rules onto the engine can't regress a default),
 * plus the kind wiring.
 */

test("kindRootConstraints('form') is the form container floor set; other kinds have none", () => {
  assert.equal(kindRootConstraints("form"), FORM_CONTAINER_CONSTRAINTS);
  assert.ok(FORM_CONTAINER_CONSTRAINTS.every((c) => c.kind === "floor"));
  for (const kind of ["report", "dashboard", "screen", "primitive", "mapping", "businessRule", "methodology", "jsonDef"]) {
    assert.deepEqual(kindRootConstraints(kind), []);
  }
});

test("every SHIPPED form satisfies the form container floors (no seed/import regression)", () => {
  for (const form of formCatalogue()) {
    const errors = evaluateConstraints(form as unknown as Record<string, unknown>, FORM_CONTAINER_CONSTRAINTS);
    assert.deepEqual(errors, [], `shipped form "${form.id}" must satisfy the container floors`);
  }
});

test("the floors bite: no title, two titles, or a duplicated scalar target each fail", () => {
  const noTitle = { fields: [{ mapTo: "priority" }] };
  const twoTitle = { fields: [{ mapTo: "title" }, { mapTo: "title" }] };
  const dupScalar = { fields: [{ mapTo: "title" }, { mapTo: "priority" }, { mapTo: "priority" }] };
  assert.ok(evaluateConstraints(noTitle, FORM_CONTAINER_CONSTRAINTS).length >= 1);
  assert.ok(evaluateConstraints(twoTitle, FORM_CONTAINER_CONSTRAINTS).length >= 1);
  assert.ok(evaluateConstraints(dupScalar, FORM_CONTAINER_CONSTRAINTS).length >= 1);
  // A valid single-title form with an aggregating repeat passes.
  const ok = { fields: [{ mapTo: "title" }, { mapTo: "description" }, { mapTo: "description" }] };
  assert.deepEqual(evaluateConstraints(ok, FORM_CONTAINER_CONSTRAINTS), []);
});
