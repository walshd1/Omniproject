import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStakeholders, stakeholderRows, StakeholderError } from "./stakeholder";

test("validateStakeholders: accepts valid rows, normalises level case, emits rows", () => {
  const out = validateStakeholders([{ id: "s1", name: "Ada", role: "Sponsor", influence: "High", interest: "medium", engagement: "champion" }]);
  assert.equal(out[0]!.influence, "high");
  assert.deepEqual(stakeholderRows(out)[0], { name: "Ada", role: "Sponsor", influence: "high", interest: "medium", engagement: "champion" });
});
test("validateStakeholders: requires id/name + valid levels, rejects dupes + non-array", () => {
  assert.throws(() => validateStakeholders([{ id: "s1", name: "", influence: "high", interest: "low" }]), StakeholderError);
  assert.throws(() => validateStakeholders([{ id: "s1", name: "x", influence: "huge", interest: "low" }]), StakeholderError);
  assert.throws(() => validateStakeholders([{ id: "s1", name: "x", influence: "high", interest: "low" }, { id: "s1", name: "y", influence: "low", interest: "low" }]), StakeholderError);
  assert.throws(() => validateStakeholders("nope"), StakeholderError);
});
