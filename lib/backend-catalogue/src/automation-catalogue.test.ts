import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, getActionDef, getTriggerDef, getRuleSurface, recipeMutates } from "./automation-catalogue";

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
  const base = { id: "r", label: "R", scope: { kind: "org" as const }, trigger: { kind: "issue.created" } };
  assert.equal(recipeMutates({ ...base, actions: [{ kind: "notify", params: {} }] }), false);
  assert.equal(recipeMutates({ ...base, actions: [{ kind: "notify", params: {} }, { kind: "set-field", params: {} }] }), true);
});

test("triggers are GENERATED from surfaces × verbs, and stay surface-agnostic", () => {
  // The historical issue kinds still resolve (back-compat with stored recipes).
  assert.equal(getTriggerDef("issue.created")?.mode, "event");
  assert.equal(getTriggerDef("issue.updated")?.mode, "event");
  // A new surface fires without any engine change — task.status-changed exists and carries surface+verb.
  const taskStatus = getTriggerDef("task.status-changed");
  assert.ok(taskStatus, "task.status-changed should be a generated trigger");
  assert.equal(taskStatus!.surface, "task");
  assert.equal(taskStatus!.verb, "status-changed");
  // Every event trigger's kind is exactly `<surface>.<verb>` for a catalogued surface.
  for (const t of AUTOMATION_TRIGGERS.filter((x) => x.mode === "event")) {
    assert.equal(t.kind, `${t.surface}.${t.verb}`);
    assert.ok(getRuleSurface(t.surface!), `trigger ${t.kind} references a known surface`);
  }
});

test("RULE_SURFACES: issue keeps its write effect; new surfaces are observe/notify-only for now", () => {
  assert.equal(getRuleSurface("issue")?.writeEffect, "broker.writeIssue");
  assert.equal(getRuleSurface("task")?.writeEffect, undefined); // no broker write wired yet (gated-mutation phase)
  assert.equal(getRuleSurface("nope"), undefined);
});

test("new field-write actions are catalogued (surface-targeted) and mutating", () => {
  for (const kind of ["set-status", "assign"]) {
    const a = getActionDef(kind);
    assert.ok(a, `${kind} should be catalogued`);
    assert.equal(a!.mutating, true);
    assert.equal(a!.surface, "issue");
  }
  assert.ok(AUTOMATION_ACTIONS.every((a) => a.kind === "notify" ? a.surface === undefined : typeof a.surface === "string"));
});
