import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth, runHealthWatch, recentFindings, __resetHealthWatch, DEFAULT_THRESHOLDS, getHealthThresholds, setHealthThresholds, type HealthFinding } from "./health-watch";
import type { Broker, PortfolioRow } from "../broker/types";

/**
 * Health watch: pure KPI rules over the portfolio read model, run as a keyed actor that
 * notifies per finding (read-only).
 */
afterEach(() => __resetHealthWatch());

const AT = "2026-01-01T00:00:00.000Z";
const row = (p: Partial<PortfolioRow>): PortfolioRow => ({
  projectId: "P1", projectName: "Apollo", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0, ...p,
});

test("a healthy portfolio yields no findings", () => {
  assert.deepEqual(evaluateHealth([row({})], AT), []);
});

test("each KPI rule fires on its trigger", () => {
  const red = evaluateHealth([row({ ragStatus: "red" })], AT);
  assert.equal(red[0]!.ruleId, "rag-red");
  assert.equal(red[0]!.severity, "critical");
  assert.ok(evaluateHealth([row({ scheduleVarianceDays: 7 })], AT).some((f) => f.ruleId === "schedule-slip"));
  assert.ok(evaluateHealth([row({ budgetVariancePercentage: 25 })], AT).some((f) => f.ruleId === "budget-overrun"));
  assert.ok(evaluateHealth([row({ activeBlockersCount: 3 })], AT).some((f) => f.ruleId === "blockers"));
});

test("thresholds are respected (just under ⇒ no finding)", () => {
  const t = DEFAULT_THRESHOLDS;
  assert.deepEqual(evaluateHealth([row({ scheduleVarianceDays: t.scheduleSlipDays - 1 })], AT), []);
  assert.deepEqual(evaluateHealth([row({ budgetVariancePercentage: t.budgetOverrunPct - 1 })], AT), []);
});

test("setHealthThresholds tunes the active thresholds (merge over defaults, validate numbers)", () => {
  // A tighter slip threshold makes a previously-fine row fire; invalid/missing fields fall back.
  setHealthThresholds({ scheduleSlipDays: 2, budgetOverrunPct: -5, junk: "x" });
  assert.deepEqual(getHealthThresholds(), { scheduleSlipDays: 2, budgetOverrunPct: DEFAULT_THRESHOLDS.budgetOverrunPct, blockers: DEFAULT_THRESHOLDS.blockers });
  // runHealthWatch now uses the tuned thresholds when none are passed explicitly.
  assert.ok(evaluateHealth([row({ scheduleVarianceDays: 3 })], AT, getHealthThresholds()).some((f) => f.ruleId === "schedule-slip"));
});

test("runHealthWatch reads via the broker as the keyed actor, notifies, and records findings", async () => {
  const seen: { ctxSub?: string } = {};
  const broker = {
    portfolioHealth: async (ctx: { sub?: string }) => { seen.ctxSub = ctx.sub; return [row({ ragStatus: "red" }), row({ projectId: "P2", projectName: "Zeus", activeBlockersCount: 2 })]; },
  } as unknown as Broker;
  const notified: HealthFinding[] = [];
  const findings = await runHealthWatch({ now: Date.parse(AT), broker, notify: (f) => notified.push(f) });

  // Ran as the keyed autonomous principal.
  assert.equal(seen.ctxSub, "automation:health-watch");
  // RED (critical) + 2 blockers (warning).
  assert.equal(findings.length, 2);
  assert.equal(notified.length, 2);
  assert.deepEqual(recentFindings().map((f) => f.ruleId).sort(), ["blockers", "rag-red"]);
});

test("an unhealthy run with no rows yields nothing", async () => {
  const broker = { portfolioHealth: async () => [] } as unknown as Broker;
  const findings = await runHealthWatch({ now: Date.parse(AT), broker, notify: () => {} });
  assert.deepEqual(findings, []);
});
