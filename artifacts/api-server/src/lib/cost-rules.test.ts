import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCostRules, firedCostRuleIds, type CostRule } from "./cost-rules";

const base = { margin: 0.2, overhead: 0.1 };

test("a matching rule overrides the uplift; intra-company → margin 0 is just one such rule", () => {
  const rules: CostRule[] = [
    { id: "intra", when: { all: [{ field: "intraCompany", op: "truthy" }] }, effect: { margin: 0 } },
  ];
  // intra-company project: margin forced to 0, overhead inherited from base.
  assert.deepEqual(applyCostRules(base, rules, { intraCompany: true }), { margin: 0, overhead: 0.1 });
  // ordinary project: no rule fires, base uplift unchanged.
  assert.deepEqual(applyCostRules(base, rules, { intraCompany: false }), base);
});

test("the engine is general — any predicate, not just intra-company", () => {
  const rules: CostRule[] = [
    // premium margin for a specific programme's delivery work
    { id: "premium", when: { all: [{ field: "programmeId", op: "eq", value: "prog-vip" }, { field: "projectType", op: "eq", value: "delivery" }] }, effect: { margin: 0.45 } },
    // zero margin when a project's projection has gone negative (loss-leader / recovery)
    { id: "recovery", when: { all: [{ field: "projection", op: "negative" }] }, effect: { margin: 0, overhead: 0 } },
  ];
  assert.deepEqual(applyCostRules(base, rules, { programmeId: "prog-vip", projectType: "delivery" }), { margin: 0.45, overhead: 0.1 });
  assert.deepEqual(applyCostRules(base, rules, { projection: -5000 }), { margin: 0, overhead: 0 });
  assert.deepEqual(applyCostRules(base, rules, { programmeId: "other" }), base);
});

test("rules apply in order — a later, more specific rule wins per field", () => {
  const rules: CostRule[] = [
    { id: "broad", effect: { margin: 0.3 } }, // no `when` → always
    { id: "specific", when: { all: [{ field: "budget", op: "gt", value: 100000 }] }, effect: { margin: 0.5 } },
  ];
  assert.equal(applyCostRules(base, rules, { budget: 250000 }).margin, 0.5); // both fire, specific wins
  assert.equal(applyCostRules(base, rules, { budget: 10000 }).margin, 0.3); // only the broad rule
});

test("negative effect values are ignored (uplift never goes below zero)", () => {
  assert.equal(applyCostRules(base, [{ id: "bad", effect: { margin: -1 } }], {}).margin, 0.2);
});

test("firedCostRuleIds reports which rules matched (explainability)", () => {
  const rules: CostRule[] = [
    { id: "a", when: { all: [{ field: "intraCompany", op: "truthy" }] }, effect: { margin: 0 } },
    { id: "b", effect: { overhead: 0.05 } },
  ];
  assert.deepEqual(firedCostRuleIds(rules, { intraCompany: true }), ["a", "b"]);
  assert.deepEqual(firedCostRuleIds(rules, { intraCompany: false }), ["b"]);
});
