import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAutomations, compileRecipe, matchesConditions, recipeRequirements, actionProjectId, AutomationError } from "./automation";
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

test("compileRecipe compiles ACTIONS only (conditions are evaluated by the runner)", () => {
  const [inform] = validateAutomations([INFORM]);
  const wf = compileRecipe(inform!);
  assert.equal(wf.id, "recipe:r1");
  assert.equal(wf.steps.length, 1);
  assert.equal(wf.steps[0]!.kind, "action");
  assert.equal(wf.steps[0]!.action, "notify");
});

test("matchesConditions evaluates the trigger-subject predicate (ALL must pass)", () => {
  const [inform] = validateAutomations([INFORM]); // condition: priority eq high
  assert.equal(matchesConditions(inform!, { priority: "high" }), true);
  assert.equal(matchesConditions(inform!, { priority: "low" }), false);
  assert.equal(matchesConditions(inform!, {}), false);
  // no conditions ⇒ always matches
  const [mutating] = validateAutomations([MUTATING]);
  assert.equal(matchesConditions(mutating!, {}), true);
  // operator coverage
  const r = validateAutomations([{ ...INFORM, conditions: [
    { field: "status", op: "in", value: "todo, doing" }, { field: "points", op: "gt", value: "3" }, { field: "blocked", op: "truthy" },
  ] }])[0]!;
  assert.equal(matchesConditions(r, { status: "doing", points: 5, blocked: true }), true);
  assert.equal(matchesConditions(r, { status: "done", points: 5, blocked: true }), false); // status not in set
  assert.equal(matchesConditions(r, { status: "todo", points: 2, blocked: true }), false); // points not > 3
});
