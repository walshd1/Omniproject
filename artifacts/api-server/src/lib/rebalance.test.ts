import { test } from "node:test";
import assert from "node:assert/strict";
import { rebalanceMessages, parseSteps, proposeRebalance } from "./rebalance";
import { scopeContext } from "./copilot";
import type { McpTool } from "./mcp";
import type { Broker, PortfolioRow } from "../broker/types";

/**
 * Agentic rebalancing: PROPOSE-only, constrained to the approved tool catalogue. The load-bearing
 * safety property is that an invented or unapproved tool NEVER becomes a proposal.
 */
const row = (p: Partial<PortfolioRow> & Record<string, unknown>): PortfolioRow => ({
  projectId: "P1", projectName: "Apollo", ragStatus: "red", scheduleVarianceDays: 9, budgetVariancePercentage: 20, activeBlockersCount: 2, ...p,
} as PortfolioRow);

// A tiny approved WRITE-tool catalogue (what a route would pass in).
const TOOLS: McpTool[] = [
  { name: "omniproject_update_issue", action: "update_issue", description: "Update an issue.", inputSchema: { type: "object", properties: { issueId: { type: "string" }, priority: { type: "string" } }, required: ["issueId"] }, write: true },
];
const broker = (rows: PortfolioRow[]) => ({ portfolioHealth: async () => rows } as unknown as Broker);

test("the prompt frames data as untrusted, is propose-only, and lists ONLY the allowed tools", () => {
  const msgs = rebalanceMessages(scopeContext([row({})]), TOOLS);
  const system = msgs.find((m) => m.role === "system")!.content;
  assert.match(system, /never execute/i);
  assert.match(system, /untrusted/i);
  assert.match(system, /never invent a tool/i);
  const user = msgs.find((m) => m.role === "user")!.content;
  assert.match(user, /omniproject_update_issue/);
  assert.match(user, /<<<DATA/);
});

test("parseSteps defensively reads the steps array (and tolerates junk entries)", () => {
  const steps = parseSteps('{"steps":[{"tool":"omniproject_update_issue","args":{"issueId":"I1"},"reason":"overdue"}, null, {"nope":1}]}');
  assert.equal(steps.length, 2); // the null entry is dropped; the {"nope":1} object is kept but neutered
  assert.equal(steps[0]!.tool, "omniproject_update_issue");
  assert.equal(steps[1]!.tool, ""); // no "tool" string → empty (dropped later by toPlan)
});

test("proposeRebalance keeps only steps that validate against the approved catalogue", async () => {
  const raw = JSON.stringify({ steps: [
    { tool: "omniproject_update_issue", args: { issueId: "I1", priority: "high", INJECTED: "x" }, reason: "Apollo is red and overdue" },
    { tool: "omniproject_delete_everything", args: {}, reason: "an invented tool" },     // not in catalogue → dropped
    { tool: "omniproject_update_issue", args: { priority: "low" }, reason: "missing required issueId" }, // missing required → dropped
  ] });
  const plan = await proposeRebalance({ broker: broker([row({})]), ctx: { sub: "u1" }, tools: TOOLS, complete: async () => raw });

  assert.equal(plan.considered, 3);
  assert.equal(plan.proposals.length, 1); // only the first, fully-valid step survives
  const p = plan.proposals[0]!;
  assert.equal(p.action, "update_issue");
  assert.equal(p.write, true);
  assert.deepEqual(Object.keys(p.args).sort(), ["issueId", "priority"]); // invented "INJECTED" arg stripped by toPlan
  assert.match(p.reason, /overdue/);
});

test("proposeRebalance never proposes more than the hard step cap", async () => {
  const many = { steps: Array.from({ length: 12 }, (_, i) => ({ tool: "omniproject_update_issue", args: { issueId: `I${i}` }, reason: "x" })) };
  const plan = await proposeRebalance({ broker: broker([row({})]), ctx: { sub: "u1" }, tools: TOOLS, complete: async () => JSON.stringify(many) });
  assert.ok(plan.proposals.length <= 5, `expected ≤5, got ${plan.proposals.length}`);
});

test("empty portfolio proposes nothing WITHOUT calling the model", async () => {
  let called = false;
  const plan = await proposeRebalance({ broker: broker([]), ctx: { sub: "u1" }, tools: TOOLS, complete: async () => { called = true; return "{}"; } });
  assert.equal(called, false);
  assert.deepEqual(plan.proposals, []);
  assert.equal(plan.projects, 0);
});

test("a model that returns no valid JSON yields zero proposals (no crash)", async () => {
  const plan = await proposeRebalance({ broker: broker([row({})]), ctx: { sub: "u1" }, tools: TOOLS, complete: async () => "I refuse." });
  assert.deepEqual(plan.proposals, []);
});
