import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, getActionDef, getTriggerDef, recipeMutates } from "./automation-catalogue";

test("every action declares a permission requirement + an effect", () => {
  for (const a of AUTOMATION_ACTIONS) {
    assert.ok(a.label && a.effect, `action ${a.kind} needs label + effect`);
    assert.ok(a.requires && typeof a.requires.kind === "string", `action ${a.kind} needs a requirement`);
    // Only the inform action is non-mutating.
    if (a.kind === "notify") assert.equal(a.mutating, false); else assert.equal(a.mutating, true);
  }
  assert.ok(AUTOMATION_TRIGGERS.some((t) => t.mode === "schedule"));
  assert.ok(AUTOMATION_TRIGGERS.some((t) => t.mode === "event"));
});

test("getActionDef / getTriggerDef resolve by kind", () => {
  assert.equal(getActionDef("notify")?.mutating, false);
  assert.equal(getActionDef("set-field")?.mutating, true);
  assert.equal(getActionDef("nope"), undefined);
  assert.equal(getTriggerDef("schedule")?.mode, "schedule");
});

test("recipeMutates is true iff any action mutates", () => {
  const base = { id: "r", label: "R", scope: { kind: "org" as const }, trigger: { kind: "issue.created" as const } };
  assert.equal(recipeMutates({ ...base, actions: [{ kind: "notify", params: {} }] }), false);
  assert.equal(recipeMutates({ ...base, actions: [{ kind: "notify", params: {} }, { kind: "set-field", params: {} }] }), true);
});
