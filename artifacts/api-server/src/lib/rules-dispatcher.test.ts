import { test } from "node:test";
import assert from "node:assert/strict";
import type { AutomationRecipe } from "@workspace/backend-catalogue";
import { dispatchDomainEvent, ruleActorId, ruleRunAction } from "./rules-dispatcher";
import { registerAutonomousGrant, __resetAutonomousGrants } from "./autonomous-grant";
import { updateSettings } from "./settings";
import { onDomainEvent, type DomainEvent } from "./domain-event";

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
  assert.deepEqual(r.deniedNoGrant, []);
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

test("a mutating recipe is DENIED by default (no autonomous grant) — nothing writes", async () => {
  __resetAutonomousGrants();
  const mutating = notifyRecipe({
    id: "auto-assign", scope: { kind: "project", projectId: "p1" },
    actions: [{ kind: "assign", params: { assignee: "u9" } }],
  });
  const r = await dispatchDomainEvent(event(), [mutating]);
  assert.deepEqual(r.ran, []);
  assert.deepEqual(r.deniedNoGrant, ["auto-assign"]); // default-deny: no grant ⇒ no write
});

test("a mutating recipe RUNS when an admin grant authorises it (create-issue lands the write)", async () => {
  __resetAutonomousGrants();
  const id = "auto-create";
  // Default AI containment is the strictest ("public"), so the grant must enumerate scope + carry a time
  // bound and write cap — the same discipline every autonomous write is held to.
  registerAutonomousGrant({
    actorId: ruleActorId(id),
    actions: ["create_issue"],
    projects: ["p1"], surfaces: ["issue"], fields: ["title", "status"],
    notAfter: 9_999_999_999_999, maxWrites: 10,
  });
  const recipe = notifyRecipe({
    id, scope: { kind: "project", projectId: "p1" },
    actions: [{ kind: "create-issue", params: { projectId: "p1", title: "Auto", status: "triage" } }],
  });
  const r = await dispatchDomainEvent(event(), [recipe]);
  assert.deepEqual(r.deniedNoGrant, []); // the gate opened
  assert.deepEqual(r.ran, [id]);          // the write landed
  __resetAutonomousGrants();
});

test("a mutating recipe bound to an approval chain is HELD (proposal raised) — nothing writes", async () => {
  __resetAutonomousGrants();
  const id = "gated-assign";
  // Even WITH a grant, an approval binding takes precedence: the run is held for sign-off, not executed.
  registerAutonomousGrant({ actorId: ruleActorId(id), actions: ["update_issue"], projects: ["p1"], surfaces: ["issue"], fields: ["assignee"], notAfter: 9_999_999_999_999, maxWrites: 10 });
  updateSettings({
    approvalChains: [{ id: "rule-chain", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "admin" }] }] }],
    approvalBindings: [{ action: ruleRunAction(id), chainId: "rule-chain" }],
  });
  const recipe = notifyRecipe({ id, scope: { kind: "project", projectId: "p1" }, actions: [{ kind: "assign", params: { assignee: "u9" } }] });
  const r = await dispatchDomainEvent(event(), [recipe]);
  assert.deepEqual(r.deferredApproval, [id]); // held for approval
  assert.deepEqual(r.ran, []);                 // nothing ran
  assert.deepEqual(r.deniedNoGrant, []);
  updateSettings({ approvalChains: [], approvalBindings: [] });
  __resetAutonomousGrants();
});

test("a mix: the inform recipe runs, the ungranted mutating one is denied, in one dispatch", async () => {
  __resetAutonomousGrants();
  const r = await dispatchDomainEvent(event(), [
    notifyRecipe({ id: "inform" }),
    notifyRecipe({ id: "mutate", scope: { kind: "project", projectId: "p1" }, actions: [{ kind: "set-status", params: { status: "triage" } }] }),
  ]);
  assert.deepEqual(r.ran, ["inform"]);
  assert.deepEqual(r.deniedNoGrant, ["mutate"]);
});

const tick = () => new Promise((r) => setImmediate(r));

test("cascade guard: an event past the depth cap is dropped wholesale", async () => {
  const deep = event({ causation: { depth: 999, rootEventId: "evt-1", rulePath: [] } });
  const r = await dispatchDomainEvent(deep, [notifyRecipe()]);
  assert.equal(r.droppedDepth, true);
  assert.deepEqual(r.ran, []);
});

test("cascade guard: a rule already in the cascade path is skipped (cycle break)", async () => {
  const looped = event({ causation: { depth: 2, rootEventId: "evt-1", rulePath: ["notify-blocked"] } });
  const r = await dispatchDomainEvent(looped, [notifyRecipe({ id: "notify-blocked" })]);
  assert.deepEqual(r.ran, []);
  assert.deepEqual(r.skippedCascade, ["notify-blocked"]);
});

test("emergent chaining: a mutating rule's write emits a follow-on event one generation deeper", async () => {
  __resetAutonomousGrants();
  const id = "auto-create-chain";
  registerAutonomousGrant({
    actorId: ruleActorId(id), actions: ["create_issue"],
    projects: ["p1"], surfaces: ["issue"], fields: ["title", "status"],
    notAfter: 9_999_999_999_999, maxWrites: 10,
  });
  const captured: DomainEvent[] = [];
  const off = onDomainEvent((e) => { captured.push(e); });
  const recipe = notifyRecipe({
    id, scope: { kind: "project", projectId: "p1" },
    actions: [{ kind: "create-issue", params: { projectId: "p1", title: "Auto", status: "triage" } }],
  });
  const r = await dispatchDomainEvent(event(), [recipe]); // parent causation depth 0
  assert.deepEqual(r.ran, [id]);
  await tick(); // the follow-on emit is out-of-band
  const followOn = captured.find((e) => e.triggerKind === "issue.created");
  assert.ok(followOn, "the create should emit an issue.created follow-on event");
  assert.equal(followOn!.causation.depth, 1);            // one generation deeper
  assert.ok(followOn!.causation.rulePath.includes(id));  // the firing rule is on the path (cycle-detectable)
  assert.equal(followOn!.actor.actorKind, "automation"); // written by the rule's autonomous principal
  off();
  __resetAutonomousGrants();
});
