import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAutomations, compileRecipe, recipeRequirements, actionProjectId, AutomationError } from "./automation";
import { recipeMutates } from "@workspace/backend-catalogue";

/**
 * Automation recipes — validation, compile-to-workflow, and the RBAC requirement set. Pure; malformed
 * recipes throw {@link AutomationError} (→ 400).
 */
const INFORM = {
  id: "r1", label: "Notify on high priority", scope: { kind: "org" },
  trigger: { kind: "issue.created" },
  conditions: [{ field: "priority", op: "eq", value: "high" }],
  actions: [{ kind: "notify", params: { to: "pm@x.io", message: "New high-priority item" } }],
};
const MUTATING = {
  id: "r2", label: "Auto-triage", scope: { kind: "project", projectId: "proj-001" },
  trigger: { kind: "issue.created" },
  actions: [{ kind: "set-field", params: { status: "triage" } }],
};

test("validateAutomations accepts well-formed recipes", () => {
  const recipes = validateAutomations([INFORM, MUTATING]);
  assert.equal(recipes.length, 2);
  assert.equal(recipes[0]!.trigger.kind, "issue.created");
  assert.equal(recipes[0]!.conditions![0]!.field, "priority");
});

test("validateAutomations rejects malformed recipes", () => {
  assert.throws(() => validateAutomations("nope"), AutomationError);
  assert.throws(() => validateAutomations([{ ...INFORM, actions: [] }]), AutomationError); // no actions
  assert.throws(() => validateAutomations([{ ...INFORM, actions: [{ kind: "bogus", params: {} }] }]), AutomationError); // unknown action
  assert.throws(() => validateAutomations([{ ...INFORM, trigger: { kind: "nope" } }]), AutomationError); // unknown trigger
  assert.throws(() => validateAutomations([{ ...INFORM, trigger: { kind: "schedule" } }]), AutomationError); // schedule needs cron
  assert.throws(() => validateAutomations([{ ...INFORM, scope: { kind: "nope" } }]), AutomationError); // bad scope
  // A mutating action in an ORG recipe must name a project.
  assert.throws(() => validateAutomations([{ ...MUTATING, scope: { kind: "org" } }]), AutomationError);
});

test("recipeMutates + recipeRequirements distinguish inform from mutating", () => {
  const [inform, mutating] = validateAutomations([INFORM, MUTATING]);
  assert.equal(recipeMutates(inform!), false);
  assert.equal(recipeMutates(mutating!), true);
  assert.deepEqual(recipeRequirements(inform!), [{ kind: "inform" }]);
  assert.deepEqual(recipeRequirements(mutating!), [{ kind: "project-write" }]);
});

test("actionProjectId resolves an explicit param, else the project scope", () => {
  const [, mutating] = validateAutomations([INFORM, MUTATING]);
  assert.equal(actionProjectId(mutating!, mutating!.actions[0]!), "proj-001"); // from scope
  const withParam = validateAutomations([{ ...MUTATING, scope: { kind: "org" }, actions: [{ kind: "set-field", params: { projectId: "proj-9", status: "x" } }] }])[0]!;
  assert.equal(actionProjectId(withParam, withParam.actions[0]!), "proj-9"); // explicit param wins
});

test("compileRecipe produces a valid workflow: conditions wrap the action steps", () => {
  const [inform] = validateAutomations([INFORM]);
  const wf = compileRecipe(inform!);
  assert.equal(wf.id, "recipe:r1");
  assert.equal(wf.steps[0]!.kind, "condition");     // the condition gates…
  assert.equal(wf.steps[0]!.then![0]!.kind, "action"); // …the action
  assert.equal(wf.steps[0]!.then![0]!.action, "notify");
});

test("compileRecipe with no conditions is a flat action list", () => {
  const [mutating] = validateAutomations([MUTATING]);
  const wf = compileRecipe(mutating!);
  assert.equal(wf.steps[0]!.kind, "action");
  assert.equal(wf.steps[0]!.action, "broker.writeIssue");
});
