import { test } from "node:test";
import assert from "node:assert/strict";
import type { AutomationRecipe } from "@workspace/backend-catalogue";
import { dispatchDomainEvent } from "./rules-dispatcher";
import type { DomainEvent } from "./domain-event";

/**
 * Rules dispatcher — selects the enabled recipes whose trigger + scope + `when` match a domain event and runs
 * the INFORM-ONLY ones (mutating recipes are deferred to the gated-mutation phase, never silently executed).
 * The recipe source is injected so selection is asserted without the config store or the notify bus.
 */

const event = (over: Partial<DomainEvent> = {}): DomainEvent => ({
  id: "evt-1", surface: "task", verb: "status-changed", triggerKind: "task.status-changed",
  subject: { id: "t1", status: "blocked", projectId: "p1" }, scope: { projectId: "p1" },
  actor: { sub: "u1", role: "manager", actorKind: "human" },
  causation: { depth: 0, rootEventId: "evt-1", rulePath: [] }, at: 1,
  ...over,
});

const notifyRecipe = (over: Partial<AutomationRecipe> = {}): AutomationRecipe => ({
  id: "notify-blocked", label: "Notify on blocked", scope: { kind: "org" },
  trigger: { kind: "task.status-changed" },
  actions: [{ kind: "notify", params: { to: "pm@x.io", message: "A task is blocked" } }],
  ...over,
});

test("runs an enabled inform recipe whose trigger + scope + when all match", async () => {
  const r = await dispatchDomainEvent(event(), [
    notifyRecipe({ when: { all: [{ field: "status", op: "eq", value: "blocked" }] } }),
  ]);
  assert.deepEqual(r.ran, ["notify-blocked"]);
  assert.deepEqual(r.skippedMutating, []);
  assert.deepEqual(r.failed, []);
});

test("filters out non-matching trigger, scope, when, and disabled recipes", async () => {
  const recipes: AutomationRecipe[] = [
    notifyRecipe({ id: "wrong-trigger", trigger: { kind: "task.created" } }),
    notifyRecipe({ id: "wrong-project", scope: { kind: "project", projectId: "p2" } }),
    notifyRecipe({ id: "when-false", when: { all: [{ field: "status", op: "eq", value: "done" }] } }),
    notifyRecipe({ id: "disabled", enabled: false }),
    notifyRecipe({ id: "matches" }), // org scope, right trigger, no when ⇒ matches
  ];
  const r = await dispatchDomainEvent(event(), recipes);
  assert.deepEqual(r.ran, ["matches"]);
});

test("a project-scoped recipe matches only its own project's events", async () => {
  const recipe = notifyRecipe({ id: "p1-only", scope: { kind: "project", projectId: "p1" } });
  assert.deepEqual((await dispatchDomainEvent(event({ scope: { projectId: "p1" } }), [recipe])).ran, ["p1-only"]);
  assert.deepEqual((await dispatchDomainEvent(event({ scope: { projectId: "p2" } }), [recipe])).ran, []);
});

test("a mutating recipe is DEFERRED, never run (inform-only phase)", async () => {
  const mutating = notifyRecipe({
    id: "auto-assign", scope: { kind: "project", projectId: "p1" },
    actions: [{ kind: "assign", params: { assignee: "u9" } }],
  });
  const r = await dispatchDomainEvent(event(), [mutating]);
  assert.deepEqual(r.ran, []);
  assert.deepEqual(r.skippedMutating, ["auto-assign"]);
});

test("a mix: the inform recipe runs, the mutating one defers, in one dispatch", async () => {
  const r = await dispatchDomainEvent(event(), [
    notifyRecipe({ id: "inform" }),
    notifyRecipe({ id: "mutate", scope: { kind: "project", projectId: "p1" }, actions: [{ kind: "set-status", params: { status: "triage" } }] }),
  ]);
  assert.deepEqual(r.ran, ["inform"]);
  assert.deepEqual(r.skippedMutating, ["mutate"]);
});
