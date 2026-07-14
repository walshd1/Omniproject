import { test } from "node:test";
import assert from "node:assert/strict";
import type { Broker, Row } from "./types";
import {
  sanitizePortfolioRow, sanitizeHistoryPoint, sanitizeFinancials, sanitizeCapacityRow,
  sanitizeProject, sanitizeIssue, sanitizeMember, sanitizeTask, sanitizeSummary, sanitizeFxRates,
  sanitizeGenericRow, wrapWithSanitizer, runWithDataQuality,
} from "./sanitizer";

test("sanitizePortfolioRow: junk/missing numeric figures repair to 0, strings to \"\"", () => {
  const r = sanitizePortfolioRow({ projectId: "p", projectName: 42, ragStatus: null, scheduleVarianceDays: "abc", budgetVariancePercentage: NaN, activeBlockersCount: undefined });
  assert.equal(r.projectId, "p");
  assert.equal(r.projectName, "42"); // number coerced to string
  assert.equal(r.ragStatus, "");
  assert.equal(r.scheduleVarianceDays, 0); // "abc" → 0
  assert.equal(r.budgetVariancePercentage, 0); // NaN → 0
  assert.equal(r.activeBlockersCount, 0); // missing → 0
});

test("sanitizePortfolioRow: valid rows are unchanged", () => {
  const r = sanitizePortfolioRow({ projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: -3, budgetVariancePercentage: 12, activeBlockersCount: 2 });
  assert.deepEqual(r, { projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: -3, budgetVariancePercentage: 12, activeBlockersCount: 2 });
});

test("sanitizeHistoryPoint: numbers coerced, unknown provenance → 'sourced', openBlockers optional", () => {
  const h = sanitizeHistoryPoint({ date: "2026-01-01", completionRate: "50", totalIssues: 10, completedIssues: NaN, openBlockers: null, provenance: "garbage" });
  assert.equal(h.completionRate, 0); // "50" string → 0 (required finite number)
  assert.equal(h.completedIssues, 0);
  assert.equal(h.openBlockers, null);
  assert.equal(h.provenance, "sourced");
});

test("sanitizeFinancials: junk money fields repair to null (so a roll-up drops, never sums raw)", () => {
  const f = sanitizeFinancials({ currency: "GBP", budgetAllocated: "1,000", actualBurn: 80000, earnedValue: NaN, forecastCostAtCompletion: null });
  assert.equal(f["budgetAllocated"], null); // "1,000" is not a finite number
  assert.equal(f["actualBurn"], 80000);
  assert.equal(f["earnedValue"], null);
  assert.equal(f["forecastCostAtCompletion"], null);
  assert.equal(f["currency"], "GBP"); // non-numeric field passes through
});

test("sanitizeCapacityRow: hours/allocation coerced to finite-or-null; extra fields kept", () => {
  const c = sanitizeCapacityRow({ resourceId: "ada", availableHours: Infinity, allocatedHours: 20, allocationPercentage: "x", assignedHours: 15 });
  assert.equal(c["availableHours"], null); // Infinity is not finite
  assert.equal(c["allocatedHours"], 20);
  assert.equal(c["allocationPercentage"], null);
  assert.equal(c["resourceId"], "ada");
});

test("sanitizeProject / sanitizeIssue: required identity coerced; optional numbers/bools normalised", () => {
  const p = sanitizeProject({ id: 7, name: null, status: "active", extra: "kept" });
  assert.equal(p.id, "7");
  assert.equal(p.name, "");
  assert.equal((p as Row)["extra"], "kept");

  const i = sanitizeIssue({ id: "i1", projectId: "p", title: "T", status: "todo", budget: "nope", loggedHours: 8, billable: 1, blocked: 0 });
  assert.equal(i.budget, null); // junk money → null
  assert.equal(i.loggedHours, 8);
  assert.equal(i.billable, true); // 1 → true
  assert.equal(i.blocked, false);
});

test("sanitizeMember: capacity hours coerced, unknown access → 'read'", () => {
  const m = sanitizeMember({ id: 7, access: "admin", availableHours: "40", allocatedHours: 20 });
  assert.equal(m["id"], "7");
  assert.equal(m["access"], "read"); // unknown enum → default
  assert.equal(m["availableHours"], null); // "40" is not a finite number
  assert.equal(m["allocatedHours"], 20);
});

test("sanitizeTask: identity coerced, estimateHours normalised", () => {
  const t = sanitizeTask({ id: "t1", title: "T", status: "open", estimateHours: NaN, assignee: "ada" });
  assert.equal(t["estimateHours"], null);
  assert.equal(t["assignee"], "ada"); // string field passes through
});

test("sanitizeSummary: total + count maps coerced to finite numbers", () => {
  const s = sanitizeSummary({ projectId: "p", total: "12", byStatus: { open: 5, done: "x" }, byPriority: { high: NaN } });
  assert.equal(s["total"], 0); // "12" string → 0 for a required number
  assert.deepEqual(s["byStatus"], { open: 5, done: 0 });
  assert.deepEqual(s["byPriority"], { high: 0 });
});

test("sanitizeFxRates: drops non-positive / non-finite rates (money-critical)", () => {
  const fx = sanitizeFxRates({ base: "GBP", rates: { GBP: 1, USD: 1.25, JPY: "bad", EUR: -1, CHF: NaN }, provenance: "sourced" });
  assert.deepEqual(fx["rates"], { GBP: 1, USD: 1.25 }); // JPY/EUR/CHF dropped → those become unconvertible, never garbage
});

test("sanitizeGenericRow: strips prototype-pollution keys, keeps the rest", () => {
  const raw = JSON.parse('{"id":"a","type":"comment","__proto__":{"admin":true}}') as Record<string, unknown>;
  const g = sanitizeGenericRow(raw);
  assert.equal(g["id"], "a");
  assert.equal(g["type"], "comment");
  assert.ok(!Object.prototype.hasOwnProperty.call(g, "__proto__"));
});

test("runWithDataQuality tallies repairs of PRESENT-but-invalid values (not legitimate absences)", async () => {
  const { quality } = await runWithDataQuality(async () => {
    sanitizePortfolioRow({ projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: "x", budgetVariancePercentage: NaN, activeBlockersCount: 3 }); // 2 repairs (x, NaN)
    sanitizeFinancials({ budgetAllocated: 100 }); // 0 repairs (valid)
    sanitizeFinancials({ actualBurn: "junk" }); // 1 repair
    sanitizeIssue({ id: "i", projectId: "p", title: "T", status: "todo", estimateHours: undefined }); // 0 repairs (absent-optional not counted)
  });
  assert.equal(quality.repaired, 3);
});

test("wrapWithSanitizer: repairs a stub broker's read outputs; unlisted reads pass through", async () => {
  const stub = {
    portfolioHealth: async (): Promise<Row[]> => [{ projectId: "p", projectName: "P", ragStatus: "AMBER", scheduleVarianceDays: "bad", budgetVariancePercentage: 5, activeBlockersCount: NaN }],
    projectFinancials: async (): Promise<Row> => ({ currency: "USD", budgetAllocated: "oops", actualBurn: 999 }),
    capabilities: async (): Promise<{ ok: boolean }> => ({ ok: true }), // unlisted → passthrough
  } as unknown as Broker;
  const b = wrapWithSanitizer(stub);

  const health = await b.portfolioHealth({} as never);
  assert.equal(health[0]!.scheduleVarianceDays, 0);
  assert.equal(health[0]!.activeBlockersCount, 0);

  const fin = await b.projectFinancials({} as never, "p");
  assert.equal(fin["budgetAllocated"], null);
  assert.equal(fin["actualBurn"], 999);

  assert.deepEqual(await (b as unknown as { capabilities: () => Promise<unknown> }).capabilities(), { ok: true });
});
