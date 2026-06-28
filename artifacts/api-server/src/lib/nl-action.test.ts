import { test } from "node:test";
import assert from "node:assert/strict";
import { planAction, toPlan, plannerPrompt, type ActionPlan } from "./nl-action";
import { MCP_TOOLS } from "./mcp";

/**
 * NL → canonical action planner: closed vocabulary, schema-bound args, writes flagged
 * and gated, ambiguity → clarify. Deterministic (the model call is injected).
 */
const reply = (s: string) => async () => s;

test("maps an instruction to a known read action", async () => {
  const plan = await planAction({ text: "list my projects", complete: reply('{"tool":"omniproject_list_projects","args":{}}') });
  assert.equal(plan.kind, "action");
  assert.equal((plan as Extract<ActionPlan, { kind: "action" }>).action, "list_projects");
  assert.equal((plan as Extract<ActionPlan, { kind: "action" }>).write, false);
});

test("an unknown tool is refused (closed vocabulary)", async () => {
  const plan = await planAction({ text: "rm -rf", complete: reply('{"tool":"omniproject_drop_database","args":{}}') });
  assert.equal(plan.kind, "none");
});

test("missing required args ⇒ clarify, not a guess", async () => {
  const plan = await planAction({ text: "show issues", complete: reply('{"tool":"omniproject_list_issues","args":{}}') });
  assert.equal(plan.kind, "clarify");
});

test("undeclared args invented by the model are dropped (no smuggling)", () => {
  const plan = toPlan({ tool: "omniproject_list_issues", args: { projectId: "P1", evil: "x", __proto__: "y" } }, MCP_TOOLS);
  assert.equal(plan.kind, "action");
  const args = (plan as Extract<ActionPlan, { kind: "action" }>).args;
  assert.deepEqual(Object.keys(args), ["projectId"]);
});

test("writes are flagged and only offered when allowWrites is set", async () => {
  const writeReply = reply('{"tool":"omniproject_update_issue","args":{"projectId":"P1","issueId":"42","status":"done"}}');
  const allowed = await planAction({ text: "mark 42 done", allowWrites: true, complete: writeReply });
  assert.equal(allowed.kind, "action");
  assert.equal((allowed as Extract<ActionPlan, { kind: "action" }>).write, true);
  // With writes disallowed the tool isn't even in the catalogue ⇒ unknown ⇒ none.
  const denied = await planAction({ text: "mark 42 done", allowWrites: false, complete: writeReply });
  assert.equal(denied.kind, "none");
});

test("clarify / none pass through; prose around the JSON is tolerated", async () => {
  assert.equal((await planAction({ text: "huh", complete: reply('{"none":"no tool fits"}') })).kind, "none");
  assert.equal((await planAction({ text: "do the thing", complete: reply('{"clarify":"which project?"}') })).kind, "clarify");
  const fenced = await planAction({ text: "projects", complete: reply('Sure!\n```json\n{"tool":"omniproject_list_projects","args":{}}\n```') });
  assert.equal(fenced.kind, "action");
});

test("an empty instruction short-circuits to none", async () => {
  assert.equal((await planAction({ text: "   ", complete: reply("{}") })).kind, "none");
});

test("the prompt lists the catalogue and the JSON contract", () => {
  const p = plannerPrompt("hello", MCP_TOOLS.filter((t) => !t.write));
  assert.match(p, /omniproject_list_projects/);
  assert.match(p, /"clarify"/);
  assert.match(p, /Instruction: hello/);
});
