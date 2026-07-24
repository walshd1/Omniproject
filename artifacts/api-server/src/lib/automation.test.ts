import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAutomations, compileRecipe, matchesConditions, conditionSetOf, recipeRequirements, actionProjectId, AutomationError } from "./automation";
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

test("compileRecipe binds a mutating action's target from the triggering subject (+ stamps the write op)", () => {
  // set-status on the triggering issue: the target issueId/projectId come from the subject.
  const recipe = validateAutomations([{
    id: "auto", label: "Auto", scope: { kind: "project", projectId: "p1" },
    trigger: { kind: "issue.updated" },
    actions: [{ kind: "set-status", params: { status: "triage" } }],
  }])[0]!;
  const wf = compileRecipe(recipe, { id: "iss-9", projectId: "p1", status: "blocked" });
  const params = wf.steps[0]!.params as Record<string, unknown>;
  assert.equal(wf.steps[0]!.action, "broker.writeIssue");
  assert.equal(params["__op"], "update");
  assert.equal(params["issueId"], "iss-9");   // bound from subject.id
  assert.equal(params["projectId"], "p1");
  assert.equal(params["status"], "triage");   // author param preserved
  // create-issue compiles to a create op and does NOT bind an issueId (it makes a new one).
  const createRecipe = validateAutomations([{
    id: "mk", label: "Make", scope: { kind: "project", projectId: "p1" },
    trigger: { kind: "issue.created" },
    actions: [{ kind: "create-issue", params: { projectId: "p1", title: "X" } }],
  }])[0]!;
  const createParams = compileRecipe(createRecipe, { id: "iss-1", projectId: "p1" }).steps[0]!.params as Record<string, unknown>;
  assert.equal(createParams["__op"], "create");
  assert.equal(createParams["issueId"], undefined);
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

test("legacy flat conditions convert to a ConditionSet (in → array) for the ONE shared engine", () => {
  const [inform] = validateAutomations([INFORM]); // condition: priority eq high
  assert.deepEqual(conditionSetOf(inform!), { all: [{ field: "priority", op: "eq", value: "high" }] });
  const r = validateAutomations([{ ...INFORM, conditions: [{ field: "status", op: "in", value: "todo, doing" }] }])[0]!;
  assert.deepEqual(conditionSetOf(r), { all: [{ field: "status", op: "in", value: ["todo", "doing"] }] });
});

test("new `when` ConditionSet: all/any nesting is validated + evaluated, and wins over legacy conditions", () => {
  // all-of AND any-of, with the richer operator set (gte/nin) the legacy flat shape lacks.
  const rich = validateAutomations([{ ...INFORM, conditions: undefined, when: {
    all: [{ field: "points", op: "gte", value: 3 }],
    any: [{ field: "status", op: "eq", value: "doing" }, { field: "status", op: "eq", value: "review" }],
  } }])[0]!;
  assert.equal(matchesConditions(rich, { points: 3, status: "review" }), true);
  assert.equal(matchesConditions(rich, { points: 5, status: "done" }), false);  // any-of fails
  assert.equal(matchesConditions(rich, { points: 2, status: "doing" }), false); // all-of fails
  // `when` takes precedence over a legacy `conditions` on the same recipe.
  const both = validateAutomations([{ ...INFORM, when: { all: [{ field: "priority", op: "eq", value: "low" }] } }])[0]!;
  assert.equal(matchesConditions(both, { priority: "low" }), true);   // when matched
  assert.equal(matchesConditions(both, { priority: "high" }), false); // legacy would have matched; when wins
});

test("validateAutomations rejects a malformed `when`", () => {
  assert.throws(() => validateAutomations([{ ...INFORM, when: "nope" }]), AutomationError);           // not an object
  assert.throws(() => validateAutomations([{ ...INFORM, when: { all: "nope" } }]), AutomationError);  // all not an array
  assert.throws(() => validateAutomations([{ ...INFORM, when: { all: [{ op: "eq", value: 1 }] } }]), AutomationError); // predicate missing field
  assert.throws(() => validateAutomations([{ ...INFORM, when: { any: [{ field: "s", op: "bogus" }] } }]), AutomationError); // bad op
});
