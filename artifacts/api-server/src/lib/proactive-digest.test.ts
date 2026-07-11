import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildProactiveDigest,
  runProactiveDigest,
  setDigestThresholds,
  getDigestThresholds,
  DEFAULT_DIGEST_THRESHOLDS,
  __resetDigestThresholds,
  startProactiveDigestScheduler,
  __stopProactiveDigestScheduler,
  digestIntervalHours,
} from "./proactive-digest";
import type { Broker, PortfolioRow } from "../broker/types";
import type { Mailer } from "./email";
import { updateSettings } from "./settings";

afterEach(() => {
  delete process.env["PROACTIVE_DIGEST_INTERVAL_HOURS"];
  __stopProactiveDigestScheduler();
  __resetDigestThresholds();
  updateSettings({ digestDelivery: { emailRecipients: [] } });
});

const rows: PortfolioRow[] = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 2, activeBlockersCount: 0 },
  { projectId: "p2", projectName: "Beta", ragStatus: "amber", scheduleVarianceDays: 6, budgetVariancePercentage: 12, activeBlockersCount: 1 },
  { projectId: "p3", projectName: "Gamma", ragStatus: "RED", scheduleVarianceDays: 12, budgetVariancePercentage: 25, activeBlockersCount: 3 },
];

const AT = "2026-07-01T00:00:00Z";

test("buildProactiveDigest prioritises sections and names the worst offenders (red before amber)", () => {
  const d = buildProactiveDigest(rows, AT);
  assert.equal(d.kind, "digest");
  assert.equal(d.empty, false);
  assert.deepEqual(d.stats, { total: 3, atRisk: 2, blockers: 2, overdue: 2, budgetBreach: 2 });

  const atRisk = d.sections.find((s) => s.id === "at-risk")!;
  assert.equal(atRisk.count, 2);
  // Gamma (red) must be named before Beta (amber).
  assert.deepEqual(atRisk.named, ["Gamma", "Beta"]);

  // Overdue is worst-schedule-slip first.
  assert.deepEqual(d.sections.find((s) => s.id === "overdue")!.named, ["Gamma", "Beta"]);
  // Budget breach is worst-overrun first.
  assert.deepEqual(d.sections.find((s) => s.id === "budget")!.named, ["Gamma", "Beta"]);

  // The body mentions the recipient-governed project names, but carries no ids or task detail.
  assert.match(d.body, /Gamma/);
  assert.doesNotMatch(d.body, /p1|p2|p3/);
});

test("an all-healthy portfolio yields an EMPTY digest (silence stays silent)", () => {
  const healthy: PortfolioRow[] = [
    { projectId: "p1", projectName: "Alpha", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0 },
    { projectId: "p2", projectName: "Beta", ragStatus: "GREEN", scheduleVarianceDays: 1, budgetVariancePercentage: 3, activeBlockersCount: 0 },
  ];
  const d = buildProactiveDigest(healthy, AT);
  assert.equal(d.empty, true);
  assert.equal(d.sections.length, 0);
  assert.deepEqual(d.stats, { total: 2, atRisk: 0, blockers: 0, overdue: 0, budgetBreach: 0 });
  assert.match(d.title, /Nothing needs you/);
});

test("an empty portfolio yields an empty, non-crashing digest", () => {
  const d = buildProactiveDigest([], AT);
  assert.equal(d.empty, true);
  assert.deepEqual(d.stats, { total: 0, atRisk: 0, blockers: 0, overdue: 0, budgetBreach: 0 });
});

test("thresholds gate the overdue/budget/blocker sections", () => {
  // Raise every threshold so Beta (slip 6, budget 8, 1 blocker) no longer qualifies for
  // overdue/budget, but Gamma still does; blockers requires >=5 so neither qualifies.
  const strict = { scheduleSlipDays: 10, budgetOverrunPct: 20, blockers: 5, maxNamed: 5 };
  const d = buildProactiveDigest(rows, AT, "manager", strict);
  assert.equal(d.stats.overdue, 1); // only Gamma (12d)
  assert.equal(d.stats.budgetBreach, 1); // only Gamma (25%)
  assert.equal(d.stats.blockers, 0); // Gamma has 3 < 5
  // at-risk is RAG-based, not threshold-based — still both.
  assert.equal(d.stats.atRisk, 2);
});

test("maxNamed caps how many names each section lists and marks the overflow", () => {
  const many: PortfolioRow[] = Array.from({ length: 6 }, (_, i) => ({
    projectId: `p${i}`, projectName: `Proj${i}`, ragStatus: "red", scheduleVarianceDays: 20 - i, budgetVariancePercentage: 30, activeBlockersCount: 2,
  }));
  const d = buildProactiveDigest(many, AT, "manager", { ...DEFAULT_DIGEST_THRESHOLDS, maxNamed: 3 });
  const atRisk = d.sections.find((s) => s.id === "at-risk")!;
  assert.equal(atRisk.count, 6);
  assert.equal(atRisk.named.length, 3);
  assert.match(d.body, /…/); // overflow ellipsis
});

test("setDigestThresholds accepts valid numbers and rejects garbage per-field", () => {
  const t = setDigestThresholds({ scheduleSlipDays: 3, budgetOverrunPct: "nope", blockers: -1, maxNamed: 2 });
  assert.equal(t.scheduleSlipDays, 3);
  assert.equal(t.budgetOverrunPct, DEFAULT_DIGEST_THRESHOLDS.budgetOverrunPct); // invalid → default
  assert.equal(t.blockers, DEFAULT_DIGEST_THRESHOLDS.blockers); // negative → default
  assert.equal(t.maxNamed, 2);
  assert.deepEqual(getDigestThresholds(), t);
});

test("runProactiveDigest reads under a viewer principal and dispatches ONE targeted digest", async () => {
  let ctxRole: string | undefined;
  const broker = {
    portfolioHealth: async (ctx: { role?: string }) => { ctxRole = ctx.role; return rows; },
  } as unknown as Broker;

  const published: { kind: string; title: string; target?: { role?: string } }[] = [];
  const { digest, dispatched } = await runProactiveDigest({
    broker, now: 1_700_000_000_000, role: "manager", publish: (n) => { published.push(n); },
  });

  assert.equal(ctxRole, "viewer"); // read-only keyed principal
  assert.equal(dispatched, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.kind, "digest");
  assert.equal(published[0]!.target?.role, "manager");
  assert.equal(digest.stats.atRisk, 2);
});

test("runProactiveDigest ALSO emails the digest to configured recipients when it dispatches", async () => {
  updateSettings({ digestDelivery: { emailRecipients: ["pm@x.io", "pgm@x.io"] } });
  const mailed: { to: string; subject: string }[] = [];
  const mailer: Mailer = { sendMail: async (m) => { mailed.push({ to: m.to, subject: m.subject }); } };
  const broker = { portfolioHealth: async () => rows } as unknown as Broker;

  const { dispatched, digest } = await runProactiveDigest({ broker, now: 1, publish: () => {}, mailer });
  assert.equal(dispatched, true);
  assert.deepEqual(mailed.map((m) => m.to), ["pm@x.io", "pgm@x.io"]); // both recipients emailed
  assert.equal(mailed[0]!.subject, digest.title); // the digest headline is the email subject
});

test("runProactiveDigest does NOT email a skipped (healthy) digest even with recipients configured", async () => {
  updateSettings({ digestDelivery: { emailRecipients: ["pm@x.io"] } });
  const mailed: unknown[] = [];
  const mailer: Mailer = { sendMail: async () => { mailed.push(1); } };
  const healthy: PortfolioRow[] = [
    { projectId: "p1", projectName: "Alpha", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0 },
  ];
  const broker = { portfolioHealth: async () => healthy } as unknown as Broker;

  const { dispatched } = await runProactiveDigest({ broker, now: 1, publish: () => {}, mailer });
  assert.equal(dispatched, false);
  assert.equal(mailed.length, 0); // silence stays silent on the email channel too
});

test("runProactiveDigest SKIPS delivery for a healthy portfolio unless sendWhenEmpty", async () => {
  const healthy: PortfolioRow[] = [
    { projectId: "p1", projectName: "Alpha", ragStatus: "green", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0 },
  ];
  const broker = { portfolioHealth: async () => healthy } as unknown as Broker;

  const published: unknown[] = [];
  const skipped = await runProactiveDigest({ broker, now: 1, publish: (n) => { published.push(n); } });
  assert.equal(skipped.dispatched, false);
  assert.equal(published.length, 0);

  const forced = await runProactiveDigest({ broker, now: 1, sendWhenEmpty: true, publish: (n) => { published.push(n); } });
  assert.equal(forced.dispatched, true);
  assert.equal(published.length, 1);
});

test("the scheduler is ON by a safe default and opts OUT at interval 0", () => {
  // Default (no env) → weekly cadence, scheduler starts.
  assert.equal(digestIntervalHours(), 24 * 7);
  assert.equal(startProactiveDigestScheduler(async () => {}), true);
  __stopProactiveDigestScheduler();

  // Explicit opt-out.
  process.env["PROACTIVE_DIGEST_INTERVAL_HOURS"] = "0";
  assert.equal(digestIntervalHours(), 0);
  assert.equal(startProactiveDigestScheduler(async () => {}), false);

  // Custom cadence.
  process.env["PROACTIVE_DIGEST_INTERVAL_HOURS"] = "12";
  assert.equal(digestIntervalHours(), 12);
  assert.equal(startProactiveDigestScheduler(async () => {}), true);
});
