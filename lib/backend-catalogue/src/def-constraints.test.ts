import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceConstraint, foldConstraints, evaluateConstraints, composedConstraintErrors } from "./def-constraints";

/**
 * def-constraints — the declarative validation-rule layer. These pin the merge algebra that makes the model
 * work: POLICY rules are child-wins (a descendant may relax OR tighten), FLOOR rules conjoin tighten-only (a
 * descendant may only make them stricter, never looser or dropped). Evaluated against the COMPOSED whole.
 */

const cardTitle = { id: "one-title", kind: "floor", type: "cardinality", path: "tags", where: { field: "role", eq: "title" }, min: 1, max: 1 };
const capValue = { id: "val-cap", kind: "floor", type: "bound", path: "value", max: 10 };
const minValuePolicy = { id: "val-min", kind: "policy", type: "bound", path: "value", min: 3 };

test("coerceConstraint accepts well-formed rules and rejects noise", () => {
  assert.ok(coerceConstraint(cardTitle));
  assert.equal(coerceConstraint({ id: "x", kind: "nope", type: "bound", path: "v" }), null); // bad kind
  assert.equal(coerceConstraint({ id: "x", kind: "floor", type: "weird", path: "v" }), null); // bad type
  assert.equal(coerceConstraint({ kind: "floor", type: "bound", path: "v" }), null);           // no id
  assert.equal(coerceConstraint("just a string"), null);                                        // unrelated data
});

test("cardinality floor: exactlyOne(title) passes with one, fails with zero or two", () => {
  const one = { tags: [{ role: "title" }, { role: "field" }] };
  const zero = { tags: [{ role: "field" }] };
  const two = { tags: [{ role: "title" }, { role: "title" }] };
  const { effective } = foldConstraints([[cardTitle]]);
  assert.deepEqual(evaluateConstraints(one, effective), []);
  assert.equal(evaluateConstraints(zero, effective).length, 1);
  assert.equal(evaluateConstraints(two, effective).length, 1);
});

test("POLICY is child-wins: a descendant may relax it", () => {
  // Ancestor requires value ≥ 3; descendant relaxes the SAME policy id to ≥ 0.
  const relaxed = { id: "val-min", kind: "policy", type: "bound", path: "value", min: 0 };
  const { effective, errors } = foldConstraints([[minValuePolicy], [relaxed]]);
  assert.deepEqual(errors, []);
  assert.deepEqual(evaluateConstraints({ value: 1 }, effective), []); // 1 ≥ 0 now → passes
});

test("FLOOR conjoins tighten-only: tightening is allowed, loosening is an error", () => {
  // Tighten: cap 10 → 5. Allowed; effective is the stricter 5.
  const tighter = { id: "val-cap", kind: "floor", type: "bound", path: "value", max: 5 };
  const t = foldConstraints([[capValue], [tighter]]);
  assert.deepEqual(t.errors, []);
  assert.equal(evaluateConstraints({ value: 6 }, t.effective).length, 1); // 6 > 5 → the tightened floor bites
  assert.deepEqual(evaluateConstraints({ value: 5 }, t.effective), []);

  // Loosen: cap 10 → 100. Rejected — you must branch above the node that introduced the floor.
  const looser = { id: "val-cap", kind: "floor", type: "bound", path: "value", max: 100 };
  const l = foldConstraints([[capValue], [looser]]);
  assert.equal(l.errors.length, 1);
  assert.match(l.errors[0]!, /relax floor|branch above/);
});

test("a floor cannot be downgraded to policy by a descendant", () => {
  const asPolicy = { id: "val-cap", kind: "policy", type: "bound", path: "value", max: 100 };
  const { errors } = foldConstraints([[capValue], [asPolicy]]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /relax floor|policy/);
});

test("unique: duplicate mapTo targets fail, except the aggregating ones (description/labels)", () => {
  const uniqTargets = { id: "uniq", kind: "floor", type: "unique", path: "fields", field: "mapTo", except: ["description", "labels"] };
  const { effective } = foldConstraints([[uniqTargets]]);
  const ok = { fields: [{ mapTo: "title" }, { mapTo: "priority" }, { mapTo: "description" }, { mapTo: "description" }] };
  assert.deepEqual(evaluateConstraints(ok, effective), []);                       // description may repeat
  const dup = { fields: [{ mapTo: "priority" }, { mapTo: "priority" }] };
  assert.equal(evaluateConstraints(dup, effective).length, 1);                    // priority may not
});

test("unique floor: a descendant may SHRINK the except set but not ADD to it", () => {
  const base = { id: "uniq", kind: "floor", type: "unique", path: "fields", field: "mapTo", except: ["description"] };
  const shrink = { id: "uniq", kind: "floor", type: "unique", path: "fields", field: "mapTo", except: [] };
  assert.deepEqual(foldConstraints([[base], [shrink]]).errors, []);               // fewer exceptions = stricter
  const grow = { id: "uniq", kind: "floor", type: "unique", path: "fields", field: "mapTo", except: ["description", "priority"] };
  const g = foldConstraints([[base], [grow]]);
  assert.equal(g.errors.length, 1);                                               // adding "priority" loosens → error
  assert.match(g.errors[0]!, /relax floor|branch above/);
});

test("a unique rule with no keying field is rejected as malformed", () => {
  assert.equal(coerceConstraint({ id: "u", kind: "floor", type: "unique", path: "fields" }), null);
});

test("enum: value must be in the allowed set; absent is skipped (presence is enforced elsewhere)", () => {
  const c = { id: "maptarget", kind: "floor", type: "enum", path: "mapTo", values: ["title", "description"] };
  const { effective } = foldConstraints([[c]]);
  assert.deepEqual(evaluateConstraints({ mapTo: "title" }, effective), []);
  assert.equal(evaluateConstraints({ mapTo: "secretField" }, effective).length, 1);
  assert.deepEqual(evaluateConstraints({}, effective), []); // absent → not this rule's job
  assert.equal(coerceConstraint({ id: "e", kind: "floor", type: "enum", path: "mapTo" }), null); // no values → malformed
});

test("enum floor: a descendant may SHRINK the allowed set but not ADD to it", () => {
  const base = { id: "maptarget", kind: "floor", type: "enum", path: "mapTo", values: ["title", "description", "priority"] };
  const shrink = { id: "maptarget", kind: "floor", type: "enum", path: "mapTo", values: ["title"] };
  assert.deepEqual(foldConstraints([[base], [shrink]]).errors, []);
  const grow = { id: "maptarget", kind: "floor", type: "enum", path: "mapTo", values: ["title", "assignee"] };
  const g = foldConstraints([[base], [grow]]);
  assert.equal(g.errors.length, 1);
  assert.match(g.errors[0]!, /relax floor|branch above/);
});

test("bound skips an ABSENT optional value (only bites when present)", () => {
  const c = { id: "cap", kind: "policy", type: "bound", path: "maxLength", min: 1 };
  const { effective } = foldConstraints([[c]]);
  assert.deepEqual(evaluateConstraints({}, effective), []);            // no maxLength → fine
  assert.deepEqual(evaluateConstraints({ maxLength: 200 }, effective), []);
  assert.equal(evaluateConstraints({ maxLength: 0 }, effective).length, 1); // present + invalid → bites
});

test("composedConstraintErrors folds a lineage and evaluates the whole in one call", () => {
  // root introduces the title floor + value cap; leaf tightens the cap and satisfies both.
  const root = [cardTitle, capValue];
  const leaf = [{ id: "val-cap", kind: "floor", type: "bound", path: "value", max: 8 }];
  const okDef = { tags: [{ role: "title" }], value: 8 };
  assert.deepEqual(composedConstraintErrors(okDef, [root, leaf]), []);
  const badDef = { tags: [], value: 9 }; // no title + over the tightened cap
  assert.equal(composedConstraintErrors(badDef, [root, leaf]).length, 2);
});

test("a def with no constraints anywhere in its lineage yields no errors (untouched)", () => {
  assert.deepEqual(composedConstraintErrors({ anything: 1 }, [[], [], []]), []);
});
