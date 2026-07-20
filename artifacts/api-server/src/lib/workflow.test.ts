import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow, validateWorkflow, type WorkflowDef, type WorkflowEffect } from "./workflow";

/** A recording effect: logs every (action, params, loop-item) and returns a scripted result per action. */
function recorder(scripted: Record<string, unknown> = {}) {
  const calls: Array<{ action: string; params: Record<string, unknown>; item?: unknown }> = [];
  const effect: WorkflowEffect = async (action, params, ctx) => {
    calls.push({ action, params, item: ctx.vars["item"] });
    return scripted[action];
  };
  return { effect, calls };
}

test("runs a linear sequence of action steps, storing each result by step id", async () => {
  const def: WorkflowDef = { id: "w", scope: { kind: "org" }, steps: [
    { id: "a", kind: "action", action: "one" },
    { id: "b", kind: "action", action: "two" },
  ] };
  const { effect, calls } = recorder({ one: 1, two: 2 });
  const ctx = await runWorkflow(def, effect);
  assert.deepEqual(calls.map((c) => c.action), ["one", "two"]);
  assert.deepEqual(ctx.results, { a: 1, b: 2 });
});

test("condition branches on a prior result (then / else)", async () => {
  const def: WorkflowDef = { id: "w", scope: { kind: "org" }, steps: [
    { id: "check", kind: "action", action: "getFlag" },
    { id: "branch", kind: "condition", test: { result: "check", equals: true },
      then: [{ id: "t", kind: "action", action: "onTrue" }],
      else: [{ id: "f", kind: "action", action: "onFalse" }] },
  ] };
  let r = recorder({ getFlag: true });
  await runWorkflow(def, r.effect);
  assert.deepEqual(r.calls.map((c) => c.action), ["getFlag", "onTrue"]);
  r = recorder({ getFlag: false });
  await runWorkflow(def, r.effect);
  assert.deepEqual(r.calls.map((c) => c.action), ["getFlag", "onFalse"]);
});

test("loop iterates the body once per element of a prior array result, binding `item`", async () => {
  const def: WorkflowDef = { id: "w", scope: { kind: "org" }, steps: [
    { id: "list", kind: "action", action: "fetchList" },
    { id: "each", kind: "loop", over: "list", body: [{ id: "do", kind: "action", action: "handle" }] },
  ] };
  const { effect, calls } = recorder({ fetchList: ["x", "y", "z"] });
  await runWorkflow(def, effect);
  assert.deepEqual(calls.filter((c) => c.action === "handle").map((c) => c.item), ["x", "y", "z"]);
});

test("a loop over a non-array/missing result is a safe no-op", async () => {
  const def: WorkflowDef = { id: "w", scope: { kind: "org" }, steps: [
    { id: "each", kind: "loop", over: "nope", body: [{ id: "do", kind: "action", action: "handle" }] },
  ] };
  const { effect, calls } = recorder();
  await runWorkflow(def, effect);
  assert.equal(calls.length, 0);
});

test("the step budget stops a runaway loop", async () => {
  const def: WorkflowDef = { id: "w", scope: { kind: "org" }, steps: [
    { id: "big", kind: "action", action: "huge" },
    { id: "each", kind: "loop", over: "big", body: [{ id: "do", kind: "action", action: "handle" }] },
  ] };
  const { effect } = recorder({ huge: Array.from({ length: 5000 }, (_, i) => i) });
  await assert.rejects(() => runWorkflow(def, effect), /step budget exceeded/);
});

test("validateWorkflow enforces id, scope, kinds, required fields, unique step ids", () => {
  const good = validateWorkflow({ id: "w", scope: { kind: "project", projectId: "p1" }, steps: [
    { id: "a", kind: "action", action: "x", params: { k: 1 } },
    { id: "c", kind: "condition", test: { result: "a", exists: true }, then: [{ id: "t", kind: "action", action: "y" }] },
  ] });
  assert.equal(good.steps.length, 2);
  assert.throws(() => validateWorkflow({ id: "", scope: { kind: "org" }, steps: [] }), /needs an id/);
  assert.throws(() => validateWorkflow({ id: "w", scope: {}, steps: [] }), /scope must be/);
  assert.throws(() => validateWorkflow({ id: "w", scope: { kind: "org" }, steps: [{ id: "a", kind: "action" }] }), /needs an action/);
  assert.throws(() => validateWorkflow({ id: "w", scope: { kind: "org" }, steps: [{ id: "a", kind: "bogus" }] }), /unknown kind/);
  assert.throws(() => validateWorkflow({ id: "w", scope: { kind: "org" }, steps: [{ id: "a", kind: "action", action: "x" }, { id: "a", kind: "action", action: "y" }] }), /duplicate step id/);
});
