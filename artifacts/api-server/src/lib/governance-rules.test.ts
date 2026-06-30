import { test } from "node:test";
import assert from "node:assert/strict";
import { governanceOverridesFor, firedGovernanceRuleIds, type GovernanceRule } from "./governance-rules";

test("a mandate scoped by `when` applies to matching projects only (lighter for small internal)", () => {
  // "Every delivery project must use PRINCE2 and the EVM report" — but NOT small-internal projects.
  const rules: GovernanceRule[] = [
    {
      id: "delivery-control",
      when: { all: [{ field: "projectType", op: "ne", value: "small-internal" }] },
      require: ["methodology:prince2", "report:evm"],
    },
  ];
  // a delivery project → the mandate applies
  assert.deepEqual(governanceOverridesFor(rules, { projectType: "delivery" }).required.sort(), ["methodology:prince2", "report:evm"]);
  // a small-internal project → lighter: the mandate does not apply
  assert.deepEqual(governanceOverridesFor(rules, { projectType: "small-internal" }).required, []);
});

test("the engine is general — forbid/disable on any predicate, deduped across rules", () => {
  const rules: GovernanceRule[] = [
    { id: "big-budget-gates", when: { all: [{ field: "budget", op: "gt", value: 1_000_000 }] }, require: ["report:stage-gate"] },
    { id: "recovery", when: { all: [{ field: "projection", op: "negative" }] }, forbid: ["report:optimistic"], disable: ["feature:autoForecast"] },
    { id: "always-evm", require: ["report:evm"] }, // no `when` → always
  ];
  const ctx = { budget: 2_000_000, projection: -50_000 };
  const o = governanceOverridesFor(rules, ctx);
  assert.deepEqual(o.required.sort(), ["report:evm", "report:stage-gate"]);
  assert.deepEqual(o.forbidden, ["report:optimistic"]);
  assert.deepEqual(o.disabled, ["feature:autoForecast"]);
});

test("no matching rule ⇒ no overrides (nothing imposed)", () => {
  const rules: GovernanceRule[] = [{ id: "x", when: { all: [{ field: "projectType", op: "eq", value: "delivery" }] }, require: ["report:evm"] }];
  assert.deepEqual(governanceOverridesFor(rules, { projectType: "internal" }), { required: [], forbidden: [], disabled: [] });
});

test("duplicate ids across rules collapse to one", () => {
  const rules: GovernanceRule[] = [
    { id: "a", require: ["report:evm"] },
    { id: "b", require: ["report:evm"] },
  ];
  assert.deepEqual(governanceOverridesFor(rules, {}).required, ["report:evm"]);
});

test("firedGovernanceRuleIds reports which rules applied", () => {
  const rules: GovernanceRule[] = [
    { id: "delivery", when: { all: [{ field: "projectType", op: "eq", value: "delivery" }] }, require: ["report:evm"] },
    { id: "always", require: ["report:raid-register"] },
  ];
  assert.deepEqual(firedGovernanceRuleIds(rules, { projectType: "delivery" }), ["delivery", "always"]);
  assert.deepEqual(firedGovernanceRuleIds(rules, { projectType: "internal" }), ["always"]);
});
