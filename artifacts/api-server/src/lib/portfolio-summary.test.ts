import { test } from "node:test";
import assert from "node:assert/strict";
import type { PortfolioRow } from "../broker";
import { summarizeHealth, foldFinance, foldCapacity, portfolioSummaryCacheKey, alignToProjects, fanoutWouldExceedCeiling } from "./portfolio-summary";

type CacheKeyCtx = Parameters<typeof portfolioSummaryCacheKey>[0];
type CacheKeySettings = Parameters<typeof portfolioSummaryCacheKey>[1];
const settings = (over: Partial<CacheKeySettings> = {}): CacheKeySettings =>
  ({ reportingCurrency: "GBP", fxRatePolicy: "spot", ...over }) as CacheKeySettings;

function row(partial: Partial<PortfolioRow>): PortfolioRow {
  return {
    projectId: "p", projectName: "P", ragStatus: "GREEN", scheduleVarianceDays: 0,
    budgetVariancePercentage: 0, activeBlockersCount: 0, ...partial,
  };
}

test("summarizeHealth: counts RAG statuses and averages variances, case-insensitively", () => {
  const rows = [
    row({ ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: 5, activeBlockersCount: 1 }),
    row({ ragStatus: "amber", scheduleVarianceDays: -4, budgetVariancePercentage: -10, activeBlockersCount: 2 }),
    row({ ragStatus: "Red", scheduleVarianceDays: 10, budgetVariancePercentage: 20, activeBlockersCount: 3 }),
  ];
  const s = summarizeHealth(rows);
  assert.equal(s.projects, 3);
  assert.deepEqual(s.rag, { green: 1, amber: 1, red: 1, other: 0 });
  assert.equal(s.avgScheduleVarianceDays, Math.round(((2 - 4 + 10) / 3) * 10) / 10);
  assert.equal(s.avgBudgetVariancePercentage, Math.round(((5 - 10 + 20) / 3) * 10) / 10);
  assert.equal(s.totalActiveBlockers, 6);
});

test("summarizeHealth: an unrecognised ragStatus falls into 'other', never dropped or thrown", () => {
  const s = summarizeHealth([row({ ragStatus: "purple" }), row({ ragStatus: "" })]);
  assert.deepEqual(s.rag, { green: 0, amber: 0, red: 0, other: 2 });
});

test("summarizeHealth: no rows ⇒ null averages, not NaN or a throw", () => {
  const s = summarizeHealth([]);
  assert.equal(s.projects, 0);
  assert.equal(s.avgScheduleVarianceDays, null);
  assert.equal(s.avgBudgetVariancePercentage, null);
  assert.equal(s.totalActiveBlockers, 0);
});

// ── foldFinance ────────────────────────────────────────────────────────────────

test("foldFinance: converts each project's currency into the target and sums to a portfolio total", () => {
  const rates = { GBP: 1, USD: 0.8, EUR: 0.85 };
  const rows = [
    { currency: "GBP", budgetAllocated: 100, actualBurn: 50, forecastCostAtCompletion: 90, earnedValue: 40 },
    { currency: "USD", budgetAllocated: 100, actualBurn: 50, forecastCostAtCompletion: 90, earnedValue: 40 }, // → GBP: *0.8
  ];
  const { totals, includedRows, droppedForFx } = foldFinance(rows, "GBP", rates);
  assert.equal(totals.currency, "GBP");
  assert.equal(totals.budget, 100 + 100 * 0.8);
  assert.equal(totals.actual, 50 + 50 * 0.8);
  assert.equal(totals.variance, totals.budget - totals.forecast);
  assert.equal(totals.cpi, Math.round((totals.earnedValue / totals.actual) * 100) / 100);
  assert.equal(includedRows, 2);
  assert.equal(droppedForFx, 0);
});

test("foldFinance: EXCLUDES a row whose currency has no FX rate — never sums a raw foreign amount", () => {
  // ₩-style unconvertible currency must not be added into a GBP total as if it were GBP.
  const { totals, includedRows, droppedForFx } = foldFinance(
    [{ currency: "ZZZ", budgetAllocated: 100, actualBurn: 0, forecastCostAtCompletion: 0, earnedValue: 0 }],
    "GBP",
    { GBP: 1 },
  );
  assert.equal(totals.budget, 0); // dropped, NOT mixed in as 100 GBP
  assert.equal(droppedForFx, 1);
  assert.equal(includedRows, 0);
});

test("foldFinance: target-currency rows fold correctly even with no rate table at all", () => {
  // FX fetch failed (rates undefined) — same-currency rows need no conversion and must still sum.
  const { totals, includedRows, droppedForFx } = foldFinance(
    [{ currency: "GBP", budgetAllocated: 100, actualBurn: 40, forecastCostAtCompletion: 90, earnedValue: 30 }],
    "GBP",
    undefined,
  );
  assert.equal(totals.budget, 100);
  assert.equal(includedRows, 1);
  assert.equal(droppedForFx, 0);
});

test("foldFinance: a dirty amount (string/null/NaN) coerces to 0 instead of poisoning the total", () => {
  const rows = [{ currency: "GBP", budgetAllocated: "not-a-number", actualBurn: null, forecastCostAtCompletion: undefined, earnedValue: 0 }];
  const { totals } = foldFinance(rows, "GBP");
  assert.equal(totals.budget, 0);
  assert.equal(totals.actual, 0);
  assert.ok(Number.isFinite(totals.variance));
});

test("foldFinance: cpi is null when there's no spend yet", () => {
  const { totals } = foldFinance([{ currency: "GBP", budgetAllocated: 100, actualBurn: 0, forecastCostAtCompletion: 100, earnedValue: 0 }], "GBP");
  assert.equal(totals.cpi, null);
});

// ── foldCapacity ───────────────────────────────────────────────────────────────

test("foldCapacity: sums hours, counts over-allocations, and computes utilisation", () => {
  const rows = [
    { allocationPercentage: 120, assignedHours: 40, availableHours: 40 },
    { allocationPercentage: 50, assignedHours: 20, availableHours: 40 },
  ];
  const totals = foldCapacity(rows);
  assert.equal(totals.allocations, 2);
  assert.equal(totals.overAllocated, 1);
  assert.equal(totals.assignedHours, 60);
  assert.equal(totals.availableHours, 80);
  assert.equal(totals.utilisation, 75); // 60/80 * 100
});

test("foldCapacity: utilisation is null when there's no declared availability", () => {
  const totals = foldCapacity([{ allocationPercentage: 100, assignedHours: 10, availableHours: 0 }]);
  assert.equal(totals.utilisation, null);
});

// ── portfolioSummaryCacheKey (scope-safety of the read-cache bucket) ─────────────

test("cache key: an all-scope admin and a programme-scoped token never share a bucket", () => {
  const admin = { sub: "admin", scope: { level: "all" } } as unknown as CacheKeyCtx;
  const progToken = { sub: "apitoken:alpha", scope: { level: "programme", programmes: ["alpha"] } } as unknown as CacheKeyCtx;
  assert.notEqual(portfolioSummaryCacheKey(admin, settings()), portfolioSummaryCacheKey(progToken, settings()));
});

test("cache key: two DIFFERENT programme scopes get different keys", () => {
  const alpha = { sub: "t", scope: { level: "programme", programmes: ["alpha"] } } as unknown as CacheKeyCtx;
  const beta = { sub: "t", scope: { level: "programme", programmes: ["beta"] } } as unknown as CacheKeyCtx;
  assert.notEqual(portfolioSummaryCacheKey(alpha, settings()), portfolioSummaryCacheKey(beta, settings()));
});

test("cache key: same identity + scope + currency ⇒ SAME key (so it can actually cache)", () => {
  const a = { sub: "u1", scope: { level: "user", sub: "u1" } } as unknown as CacheKeyCtx;
  const b = { sub: "u1", scope: { level: "user", sub: "u1" } } as unknown as CacheKeyCtx;
  assert.equal(portfolioSummaryCacheKey(a, settings()), portfolioSummaryCacheKey(b, settings()));
});

test("cache key: switching reporting currency changes the key (no wrong-currency total served)", () => {
  const ctx = { sub: "admin", scope: { level: "all" } } as unknown as CacheKeyCtx;
  assert.notEqual(
    portfolioSummaryCacheKey(ctx, settings({ reportingCurrency: "GBP" })),
    portfolioSummaryCacheKey(ctx, settings({ reportingCurrency: "USD" })),
  );
});

// ── Bulk portfolio reads (the O(1) path) ────────────────────────────────────────────────────────────
test("alignToProjects: lines bulk rows up with the project list by projectId", () => {
  const projects = [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }] as Parameters<typeof alignToProjects>[1];
  const rows = [{ projectId: "p-3", budget: 30 }, { projectId: "p-1", budget: 10 }];
  const aligned = alignToProjects(rows, projects);
  assert.equal(aligned.length, 3, "one slot per project, in project order");
  assert.equal(aligned[0]?.["budget"], 10);
  assert.equal(aligned[1], null, "a project the bulk read OMITTED is null, not a silent gap");
  assert.equal(aligned[2]?.["budget"], 30);
});

test("alignToProjects: a bulk read that omits projects reads as INCOMPLETE, not as a smaller portfolio", () => {
  // This is the failure mode that matters: a backend aggregate that quietly returns fewer rows than
  // there are projects must not produce a confident total over the subset. Nulls here become
  // droppedCalls upstream, which withholds the total.
  const projects = [{ id: "p-1" }, { id: "p-2" }] as Parameters<typeof alignToProjects>[1];
  assert.deepEqual(alignToProjects([], projects), [null, null]);
});

test("alignToProjects: falls back to `id` and ignores duplicate rows for one project", () => {
  const projects = [{ id: "p-1" }] as Parameters<typeof alignToProjects>[1];
  assert.equal(alignToProjects([{ id: "p-1", budget: 7 }], projects)[0]?.["budget"], 7);
  assert.equal(alignToProjects([{ projectId: "p-1", budget: 1 }, { projectId: "p-1", budget: 2 }], projects)[0]?.["budget"], 1, "first row wins, deterministically");
});

test("bulk reads must be scope-filtered: alignToProjects drops rows for projects the caller can't see", () => {
  // The bulk reads take no projectId, so the seam's scope guard (PROJECT_ID_AT_ARG1) does not cover
  // them. Attribution to the VISIBLE project list is what keeps another programme's rows out of a
  // scoped user's totals — the per-project path got this for free by only asking for what it could see.
  const visible = [{ id: "p-1" }] as Parameters<typeof alignToProjects>[1];
  const bulkFromBackend = [
    { projectId: "p-1", budget: 10 },
    { projectId: "p-OTHER-PROGRAMME", budget: 999999 },
  ];
  const aligned = alignToProjects(bulkFromBackend, visible);
  assert.equal(aligned.length, 1, "only the visible project has a slot");
  assert.equal(aligned[0]?.["budget"], 10);
  assert.ok(!aligned.some((r) => r?.["budget"] === 999999), "an out-of-scope row never reaches the fold");
});

test("fanoutWouldExceedCeiling: refuses a fan-out that would take minutes rather than attempting it", () => {
  // Default ceiling is 500. Below it the per-project fallback runs; above it the totals are refused
  // outright, because a 30k-project fan-out is ~150s of wall clock and 30k calls landed on a backend.
  assert.equal(fanoutWouldExceedCeiling(1), false);
  assert.equal(fanoutWouldExceedCeiling(500), false, "the ceiling itself is allowed");
  assert.equal(fanoutWouldExceedCeiling(501), true);
  assert.equal(fanoutWouldExceedCeiling(30_000), true);
});
