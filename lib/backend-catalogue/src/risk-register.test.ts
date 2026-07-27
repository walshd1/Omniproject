import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRiskRegister, RISK_SEVERITY_BANDS, type RegisterEntry } from "./risk-register";

// Literal epoch-ms (no Date/clock). DAY-aligned base; NOW is noon of that day.
const DAY = 86_400_000;
const DAY0 = 20_000 * DAY;
const NOW = DAY0 + DAY / 2;

const e = (id: string, extra: Partial<RegisterEntry> = {}): RegisterEntry => ({ id, type: "risk", status: "open", ...extra });

test("scores P×I exposure and bands it onto the canonical severity scale", () => {
  const entries = [
    e("crit", { likelihood: "high", impact: "high" }), // 3×3 = 9 ⇒ critical
    e("high", { likelihood: "high", impact: "medium" }), // 3×2 = 6 ⇒ high
    e("med", { likelihood: "medium", impact: "medium" }), // 2×2 = 4 ⇒ medium
    e("low", { likelihood: "low", impact: "low" }), // 1×1 = 1 ⇒ low
  ];
  const { topRisks, summary } = analyzeRiskRegister(entries, { now: NOW });
  const band = (id: string) => topRisks.find((r) => r.id === id)!;
  assert.equal(band("crit").exposure, 9);
  assert.equal(band("crit").band, "critical");
  assert.equal(band("high").band, "high");
  assert.equal(band("med").band, "medium");
  assert.equal(band("low").band, "low");
  assert.equal(summary.scored, 4);
  assert.equal(summary.highestExposure, 9);
  assert.equal(summary.totalExposure, 20); // 9+6+4+1
});

test("ranks top risks worst-first (exposure desc), capped by topN", () => {
  const entries = [
    e("a", { likelihood: "low", impact: "low" }), // 1
    e("b", { likelihood: "high", impact: "high" }), // 9
    e("c", { likelihood: "medium", impact: "high" }), // 6
    e("d", { likelihood: "high", impact: "medium" }), // 6
  ];
  const { topRisks } = analyzeRiskRegister(entries, { now: NOW, topN: 3 });
  // 9 first; then the two 6s id-tiebroken (c before d); a (1) dropped by the cap.
  assert.deepEqual(topRisks.map((r) => r.id), ["b", "c", "d"]);
});

test("fills the likelihood×impact heatmap grid, worst cell first, with entry counts", () => {
  const entries = [
    e("x", { likelihood: "high", impact: "high" }),
    e("y", { likelihood: "high", impact: "high" }),
    e("z", { likelihood: "low", impact: "medium" }),
  ];
  const { heatmap } = analyzeRiskRegister(entries, { now: NOW });
  assert.equal(heatmap.length, 9); // 3 likelihood × 3 impact
  assert.equal(heatmap[0]!.exposure, 9); // worst cell first
  assert.equal(heatmap[0]!.band, "critical");
  const hh = heatmap.find((c) => c.likelihood === "high" && c.impact === "high")!;
  assert.equal(hh.count, 2);
  const lm = heatmap.find((c) => c.likelihood === "low" && c.impact === "medium")!;
  assert.equal(lm.count, 1);
});

test("falls back to the declared severity when likelihood/impact are absent", () => {
  const entries = [e("a", { severity: "critical" }), e("b", { severity: "low" })];
  const { topRisks, rollup } = analyzeRiskRegister(entries, { now: NOW });
  assert.equal(topRisks.find((r) => r.id === "a")!.exposure, null);
  assert.equal(topRisks.find((r) => r.id === "a")!.band, "critical");
  assert.equal(rollup.bySeverityBand.critical, 1);
  assert.equal(rollup.bySeverityBand.low, 1);
});

test("rolls up by type and status; closed entries are not counted open", () => {
  const entries = [
    e("r1", { type: "risk" }),
    e("i1", { type: "issue", status: "mitigating" }),
    e("a1", { type: "assumption", status: "closed" }),
    e("d1", { type: "dependency" }),
    e("weird", { type: "gremlin", status: "haunted" }), // unknown ⇒ "other" buckets
  ];
  const { rollup, summary } = analyzeRiskRegister(entries, { now: NOW });
  assert.equal(rollup.byType.risk, 1);
  assert.equal(rollup.byType.issue, 1);
  assert.equal(rollup.byType.assumption, 1);
  assert.equal(rollup.byType.dependency, 1);
  assert.equal(rollup.byType.other, 1);
  assert.equal(rollup.byStatus.other, 1);
  assert.equal(summary.open, 4); // all but the closed assumption
  assert.equal(summary.closed, 1);
});

test("flags overdue mitigations only for open entries with a past due date", () => {
  const entries = [
    e("past-open", { dueDate: NOW - DAY }), // overdue
    e("future-open", { dueDate: NOW + DAY }), // not yet due
    e("past-closed", { status: "closed", dueDate: NOW - DAY }), // closed ⇒ not overdue
    e("no-due", {}),
  ];
  const { topRisks, summary } = analyzeRiskRegister(entries, { now: NOW });
  assert.equal(summary.overdueMitigations, 1);
  assert.equal(topRisks.find((r) => r.id === "past-open")!.overdue, true);
  assert.equal(topRisks.find((r) => r.id === "past-closed")!.overdue, false);
});

test("empty in ⇒ empty out (heatmap grid still present, all-zero)", () => {
  const r = analyzeRiskRegister([], { now: NOW });
  assert.deepEqual(r.topRisks, []);
  assert.equal(r.heatmap.length, 9);
  assert.ok(r.heatmap.every((c) => c.count === 0));
  assert.deepEqual(r.summary, { total: 0, open: 0, closed: 0, scored: 0, overdueMitigations: 0, highestExposure: 0, totalExposure: 0 });
});

test("malformed input is tolerated: non-objects dropped, ids coerced, unknown grades ⇒ null exposure", () => {
  const dirty = [
    null,
    undefined,
    99,
    "nope",
    { id: 7, likelihood: "high", impact: "high" }, // numeric id ⇒ "7"
    { id: "  ", severity: "high" }, // blank id ⇒ dropped
    { id: "bad-grade", likelihood: "extreme", impact: "high" }, // unknown likelihood ⇒ null exposure
    { id: "dirty-due", likelihood: "low", impact: "low", dueDate: "not-a-date" }, // dirty due ⇒ not overdue
  ] as unknown as RegisterEntry[];
  const { topRisks, summary } = analyzeRiskRegister(dirty, { now: NOW });
  const ids = topRisks.map((r) => r.id);
  assert.ok(ids.includes("7"));
  assert.ok(!ids.some((id) => id.trim() === ""));
  assert.equal(topRisks.find((r) => r.id === "bad-grade")!.exposure, null);
  assert.equal(topRisks.find((r) => r.id === "dirty-due")!.overdue, false);
  assert.equal(summary.total, 3); // 7, bad-grade, dirty-due kept; the blank-id "high"-severity entry dropped
});

test("custom exposure thresholds re-band the matrix", () => {
  // Make everything critical above exposure 1.
  const entries = [e("a", { likelihood: "low", impact: "medium" })]; // 1×2 = 2
  const { topRisks } = analyzeRiskRegister(entries, { now: NOW, exposureThresholds: { lowMax: 1, mediumMax: 1, highMax: 1 } });
  assert.equal(topRisks[0]!.band, "critical");
});

test("deterministic: same input ⇒ identical output; bands export is the canonical scale", () => {
  const entries = [e("a", { likelihood: "high", impact: "high" }), e("b", { likelihood: "medium", impact: "low" })];
  const x = analyzeRiskRegister(entries, { now: NOW });
  const y = analyzeRiskRegister(entries, { now: NOW });
  assert.deepEqual(x, y);
  assert.deepEqual([...RISK_SEVERITY_BANDS], ["low", "medium", "high", "critical"]);
});
