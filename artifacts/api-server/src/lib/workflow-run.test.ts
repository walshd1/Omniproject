import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEffects, WorkflowRunError, type EffectDeps } from "./workflow-run";
import { runWorkflow, type WorkflowDef } from "./workflow";
import type { Broker, ActorContext } from "../broker";

/**
 * The runtime effect surface is a FAIL-CLOSED allowlist: reads pass through to the broker (with the
 * caller's scope), `notify` fans out, and everything else — a broker WRITE, an unknown action — is
 * REFUSED. These tests pin that boundary with a fake broker + a recording notify.
 */

const CTX: ActorContext = { sub: "u1", role: "pmo", scopes: [] } as unknown as ActorContext;

/** A fake broker recording each read call; write methods throw if ever reached (they must not be). */
function fakeBroker(): { broker: Broker; calls: string[] } {
  const calls: string[] = [];
  const never = () => { throw new Error("write method reached from a workflow effect"); };
  const broker = {
    kind: "demo", live: false,
    listProjects: async (_c: ActorContext) => { calls.push("listProjects"); return [{ id: "P1" }, { id: "P2" }]; },
    listIssues: async (_c: ActorContext, projectId: string) => { calls.push(`listIssues:${projectId}`); return [{ id: `${projectId}-1` }]; },
    projectSummary: async (_c: ActorContext, projectId: string) => { calls.push(`projectSummary:${projectId}`); return { projectId, open: 3 }; },
    portfolioHealth: async (_c: ActorContext) => { calls.push("portfolioHealth"); return [{ id: "P1", health: "green" }]; },
    notifications: async (_c: ActorContext) => { calls.push("notifications"); return []; },
    createProject: never, updateProject: never, projectMembers: never, getIssue: never, writeIssue: never,
    listTaskItems: never, createTaskItem: never, verify: never, listActivity: never, projectHistory: never, baseline: never,
  } as unknown as Broker;
  return { broker, calls };
}

function deps(): { d: EffectDeps; calls: string[]; notes: Array<{ n: unknown; t: unknown }> } {
  const { broker, calls } = fakeBroker();
  const notes: Array<{ n: unknown; t: unknown }> = [];
  const d: EffectDeps = { broker, ctx: CTX, owner: "owner-1", notify: (n, t) => { notes.push({ n, t }); } };
  return { d, calls, notes };
}

test("effect dispatches broker reads with the caller's scope", async () => {
  const { d, calls } = deps();
  const effect = makeEffects(d);
  assert.deepEqual(await effect("broker.listProjects", {}, { results: {}, vars: {} }), [{ id: "P1" }, { id: "P2" }]);
  await effect("broker.listIssues", { projectId: "P2" }, { results: {}, vars: {} });
  await effect("broker.projectSummary", { projectId: "P1" }, { results: {}, vars: {} });
  await effect("broker.portfolioHealth", {}, { results: {}, vars: {} });
  await effect("broker.notifications", {}, { results: {}, vars: {} });
  assert.deepEqual(calls, ["listProjects", "listIssues:P2", "projectSummary:P1", "portfolioHealth", "notifications"]);
});

test("notify fans out; defaults the target to the workflow owner", async () => {
  const { d, notes } = deps();
  const effect = makeEffects(d);
  const r = await effect("notify", { kind: "alert", title: "Over budget", body: "P1 is red" }, { results: {}, vars: {} });
  assert.deepEqual(r, { sent: true });
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0]!.n, { kind: "alert", title: "Over budget", body: "P1 is red" });
  assert.deepEqual(notes[0]!.t, { sub: "owner-1" });
});

test("notify routes to an explicit sub/email when given", async () => {
  const { d, notes } = deps();
  const effect = makeEffects(d);
  await effect("notify", { title: "hi", sub: "u9", email: "u9@x.io" }, { results: {}, vars: {} });
  assert.deepEqual(notes[0]!.t, { sub: "u9", email: "u9@x.io" });
});

test("a broker WRITE action is refused (fail-closed)", async () => {
  const { d } = deps();
  const effect = makeEffects(d);
  for (const write of ["broker.writeIssue", "broker.createProject", "broker.updateProject"]) {
    await assert.rejects(effect(write, {}, { results: {}, vars: {} }), WorkflowRunError);
  }
});

test("an unknown action is refused", async () => {
  const { d, calls } = deps();
  const effect = makeEffects(d);
  await assert.rejects(effect("shell.exec", { cmd: "rm -rf /" }, { results: {}, vars: {} }), WorkflowRunError);
  assert.deepEqual(calls, []); // nothing touched the broker
});

test("a full workflow runs reads → loop → conditional notify through the real engine", async () => {
  const { d, calls, notes } = deps();
  const def: WorkflowDef = {
    id: "wf-health", scope: { kind: "org" },
    steps: [
      { id: "projects", kind: "action", action: "broker.listProjects" },
      { id: "each", kind: "loop", over: "projects", body: [
        { id: "sum", kind: "action", action: "broker.projectSummary", params: { projectId: "P1" } },
      ] },
      { id: "health", kind: "action", action: "broker.portfolioHealth" },
      { id: "gate", kind: "condition", test: { result: "health", exists: true }, then: [
        { id: "warn", kind: "action", action: "notify", params: { title: "Health ready", body: "see dashboard" } },
      ] },
    ],
  };
  const ctx = await runWorkflow(def, makeEffects(d));
  assert.deepEqual(ctx.results["projects"], [{ id: "P1" }, { id: "P2" }]);
  // loop ran once per project (2×), then portfolioHealth once.
  assert.deepEqual(calls, ["listProjects", "projectSummary:P1", "projectSummary:P1", "portfolioHealth"]);
  assert.equal(notes.length, 1); // the conditional fired
});
