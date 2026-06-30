import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePredicate, matches, selectMatching, validatePredicate, type ConditionSet } from "./predicate";

const CTX = { programmeId: "prog-1", projectType: "delivery", budget: 250000, projection: -12000, intraCompany: false };

test("binary numeric ops coerce and stay false on non-numeric / missing fields", () => {
  assert.equal(evaluatePredicate({ field: "budget", op: "gt", value: 100000 }, CTX), true);
  assert.equal(evaluatePredicate({ field: "budget", op: "lte", value: 100000 }, CTX), false);
  assert.equal(evaluatePredicate({ field: "missing", op: "gt", value: 0 }, CTX), false); // missing ≠ 0
  assert.equal(evaluatePredicate({ field: "projectType", op: "gt", value: 0 }, CTX), false); // non-numeric
});

test("eq/ne/in/nin and the unary ops", () => {
  assert.equal(evaluatePredicate({ field: "projectType", op: "eq", value: "delivery" }, CTX), true);
  assert.equal(evaluatePredicate({ field: "projectType", op: "in", value: ["delivery", "support"] }, CTX), true);
  assert.equal(evaluatePredicate({ field: "projectType", op: "nin", value: ["internal"] }, CTX), true);
  assert.equal(evaluatePredicate({ field: "projection", op: "negative" }, CTX), true);
  assert.equal(evaluatePredicate({ field: "projection", op: "nonNegative" }, CTX), false);
  assert.equal(evaluatePredicate({ field: "intraCompany", op: "falsy" }, CTX), true);
});

test("the PMO matrix example: programme AND type AND budget>x AND projection negative", () => {
  const rule: ConditionSet = {
    all: [
      { field: "programmeId", op: "eq", value: "prog-1" },
      { field: "projectType", op: "eq", value: "delivery" },
      { field: "budget", op: "gt", value: 200000 },
      { field: "projection", op: "negative" },
    ],
  };
  assert.equal(matches(rule, CTX), true);
  assert.equal(matches(rule, { ...CTX, projection: 5000 }), false); // projection no longer negative
  assert.equal(matches(rule, { ...CTX, budget: 100000 }), false); // under the budget threshold
  assert.equal(matches(rule, { ...CTX, programmeId: "prog-2" }), false); // different programme
});

test("`any` is OR-of-conditions; an empty/absent set matches everything", () => {
  const cond: ConditionSet = { any: [{ field: "projectType", op: "eq", value: "internal" }, { field: "intraCompany", op: "truthy" }] };
  assert.equal(matches(cond, CTX), false); // neither holds
  assert.equal(matches(cond, { ...CTX, intraCompany: true }), true); // one holds
  assert.equal(matches(undefined, CTX), true);
  assert.equal(matches({}, CTX), true);
});

test("selectMatching keeps declared order and only matching items", () => {
  const rules = [
    { id: "a", when: { all: [{ field: "projectType", op: "eq" as const, value: "delivery" }] } },
    { id: "b", when: { all: [{ field: "projectType", op: "eq" as const, value: "internal" }] } },
    { id: "c" }, // no condition → always applies
  ];
  assert.deepEqual(selectMatching(rules, CTX).map((r) => r.id), ["a", "c"]);
});

test("validatePredicate rejects malformed predicates", () => {
  assert.equal(validatePredicate({ field: "budget", op: "gt", value: 1 }), null);
  assert.match(validatePredicate({ op: "gt", value: 1 })!, /field/);
  assert.match(validatePredicate({ field: "x", op: "between" })!, /op must be one of/);
  assert.match(validatePredicate({ field: "x", op: "in", value: "notArray" })!, /needs an array/);
});
