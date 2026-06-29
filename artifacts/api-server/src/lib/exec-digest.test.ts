import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildExecDigest, runExecDigest, startExecDigestScheduler, __stopExecDigestScheduler } from "./exec-digest";
import type { Broker, PortfolioRow } from "../broker/types";

afterEach(() => { delete process.env["EXEC_DIGEST_INTERVAL_HOURS"]; __stopExecDigestScheduler(); });

const rows: PortfolioRow[] = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 2, activeBlockersCount: 0 },
  { projectId: "p2", projectName: "Beta", ragStatus: "amber", scheduleVarianceDays: 4, budgetVariancePercentage: 8, activeBlockersCount: 1 },
  { projectId: "p3", projectName: "Gamma", ragStatus: "RED", scheduleVarianceDays: 12, budgetVariancePercentage: 25, activeBlockersCount: 3 },
];

test("buildExecDigest aggregates RAG, worst variances and blockers (no project detail)", () => {
  const d = buildExecDigest(rows, "2026-06-29T00:00:00Z");
  assert.deepEqual(d.stats, { total: 3, red: 1, amber: 1, green: 1, atRisk: 2, worstScheduleSlipDays: 12, worstBudgetOverrunPct: 25, totalBlockers: 4 });
  assert.match(d.title, /2\/3 project\(s\) at risk/);
  // The body must not leak a project name or id — aggregates only.
  assert.doesNotMatch(d.body, /Alpha|Beta|Gamma|p1|p2|p3/);
});

test("runExecDigest reads under an autonomous principal and dispatches one notification", async () => {
  let portfolioCtxRole: string | undefined;
  const broker = {
    portfolioHealth: async (ctx: { role?: string }) => { portfolioCtxRole = ctx.role; return rows; },
  } as unknown as Broker;

  const published: { title: string }[] = [];
  const digest = await runExecDigest({ broker, now: 1_700_000_000_000, publish: (n) => { published.push(n); } });

  assert.equal(portfolioCtxRole, "viewer"); // read-only keyed principal
  assert.equal(published.length, 1);
  assert.match(published[0]!.title, /Portfolio digest/);
  assert.equal(digest.stats.atRisk, 2);
});

test("the scheduler is off unless EXEC_DIGEST_INTERVAL_HOURS > 0", () => {
  assert.equal(startExecDigestScheduler(async () => {}), false);
  process.env["EXEC_DIGEST_INTERVAL_HOURS"] = "6";
  assert.equal(startExecDigestScheduler(async () => {}), true);
});
