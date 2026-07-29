import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleExecDigest } from "./exec-digest";
import { scoreHealthPortfolio } from "./health-score";
import { rollUpObjectives } from "./okr-linkage";
import { computeEvm } from "./evm";
import { detectDuplicateDemand } from "./demand-dedup";

// Real engine outputs, so the digest is exercised against genuine result shapes.
const health = scoreHealthPortfolio([
  { id: "epic-red", dimensions: [{ id: "dependencies", label: "Dependencies", severity: 0.9 }] },
  { id: "epic-amber", dimensions: [{ id: "timeline", label: "Timeline", severity: 0.5 }] },
  { id: "epic-green", dimensions: [{ id: "ownership", severity: 0.1 }] },
]);
const okr = rollUpObjectives([
  { id: "obj-hi", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 90 }] },
  { id: "obj-lo", keyResults: [{ id: "k", kind: "number", start: 0, target: 100, current: 10 }] },
]);
const evm = computeEvm({ plannedValue: 1000, earnedValue: 800, actualCost: 1000, budgetAtCompletion: 2000 });
const duplicates = detectDuplicateDemand([
  { id: "a", text: "alpha beta gamma" },
  { id: "b", text: "alpha beta gamma" },
]);

test("headline band is the worst present in the health portfolio", () => {
  const d = assembleExecDigest({ health });
  assert.equal(d.headline.band, "red"); // one red initiative present
});

test("risks are the top-N non-green initiatives in health's worst-first order, with a reason", () => {
  const d = assembleExecDigest({ health }, { topN: 5 });
  assert.deepEqual(d.risks.map((r) => [r.id, r.band]), [["epic-red", "red"], ["epic-amber", "amber"]]);
  assert.equal(d.risks[0]!.reason, "Dependencies: Red (0.9)");
  assert.equal(d.risks.find((r) => r.id === "epic-green"), undefined); // green excluded
});

test("topN caps each ranked section", () => {
  const d = assembleExecDigest({ health }, { topN: 1 });
  assert.equal(d.risks.length, 1);
  assert.equal(d.risks[0]!.id, "epic-red");
});

test("okr section carries mean progress, off-track count, and worst objectives first", () => {
  const d = assembleExecDigest({ okr });
  assert.equal(d.okr!.meanProgress, 0.5); // (0.9 + 0.1) / 2
  assert.equal(d.okr!.offTrack, 1); // obj-lo at 0.1
  assert.equal(d.okr!.worst[0]!.id, "obj-lo"); // lowest progress first
});

test("finance section derives cost/schedule status from CPI/SPI", () => {
  const d = assembleExecDigest({ evm });
  // EV 800 / AC 1000 ⇒ CPI 0.8 < 1 ⇒ over budget; SPI = EV/PV = 800/1000 = 0.8 < 1 ⇒ behind.
  assert.equal(d.finance!.costStatus, "over-budget");
  assert.equal(d.finance!.scheduleStatus, "behind-schedule");
  assert.equal(d.finance!.costPerformanceIndex, 0.8);
});

test("duplicates section counts pairs + clusters", () => {
  const d = assembleExecDigest({ duplicates });
  assert.deepEqual(d.duplicates, { pairs: 1, clusters: 1 });
});

test("summary assembles only the parts that are present", () => {
  const d = assembleExecDigest({ health, okr, evm, duplicates });
  assert.match(d.headline.summary, /1 red, 1 amber, 1 green/);
  assert.match(d.headline.summary, /OKR progress 50% \(1 off-track\)/);
  assert.match(d.headline.summary, /EVM CPI 0\.8 \(over-budget\)/);
  assert.match(d.headline.summary, /1 duplicate-demand pair/);
});

test("absent inputs ⇒ null sections, not fabricated zeros", () => {
  const d = assembleExecDigest({ health });
  assert.equal(d.okr, null);
  assert.equal(d.finance, null);
  assert.equal(d.duplicates, null);
});

test("empty input ⇒ unknown headline and empty/null sections", () => {
  const d = assembleExecDigest({});
  assert.equal(d.headline.band, "unknown");
  assert.equal(d.headline.summary, "no portfolio signals available");
  assert.deepEqual(d.risks, []);
  assert.equal(d.okr, null);
});

test("a null EVM index carries through as a null status (never a misleading 0)", () => {
  const zero = computeEvm({ plannedValue: 0, earnedValue: 0, actualCost: 0, budgetAtCompletion: 0 });
  const d = assembleExecDigest({ evm: zero });
  assert.equal(d.finance!.costPerformanceIndex, null); // EV/AC with AC 0 ⇒ null
  assert.equal(d.finance!.costStatus, null);
});
