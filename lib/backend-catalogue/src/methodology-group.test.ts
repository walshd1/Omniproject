import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByMethodology, neutralDefs, artifactsForMethodology } from "./methodology-group";
import { METHODOLOGIES } from "./methodology-catalogue";
import { REPORTS, reportsForMethodology } from "./report-catalogue";

/** Generic grouping of methodology-tagged defs — works for any plane (tested here with reports). */

interface Def { id: string; methodologies?: string[] }
const scrum: Def = { id: "s", methodologies: ["scrum"] };
const waterfall: Def = { id: "w", methodologies: ["waterfall", "prince2"] };
const neutral: Def = { id: "n" }; // untagged → applies to all
const wildcard: Def = { id: "x", methodologies: ["*"] };
const defs: Def[] = [scrum, waterfall, neutral, wildcard];

test("one bucket per methodology, in catalogue order", () => {
  const groups = groupByMethodology(defs);
  assert.equal(groups.length, METHODOLOGIES.length);
  assert.deepEqual(groups.map((g) => g.methodology.id), METHODOLOGIES.map((m) => m.id));
});

test("a bucket holds its tagged defs plus the neutral ones", () => {
  const groups = groupByMethodology(defs, { methodologies: ["scrum", "waterfall"] });
  const byId = Object.fromEntries(groups.map((g) => [g.methodology.id, g.defs.map((d) => d.id)]));
  // scrum: its own + neutral + wildcard
  assert.deepEqual(byId["scrum"]!.sort(), ["n", "s", "x"]);
  // waterfall: the multi-tagged def + neutral + wildcard (not the scrum-only one)
  assert.deepEqual(byId["waterfall"]!.sort(), ["n", "w", "x"]);
});

test("nonEmpty drops methodologies that light up nothing", () => {
  const only = groupByMethodology([scrum], { nonEmpty: true });
  // scrum lights up (has the def); every other methodology has no applicable def → dropped.
  assert.deepEqual(only.map((g) => g.methodology.id), ["scrum"]);
});

test("neutralDefs returns the always-shown set", () => {
  assert.deepEqual(neutralDefs(defs).map((d) => d.id).sort(), ["n", "x"]);
});

test("works over the real REPORTS catalogue (every report lands in ≥1 bucket)", () => {
  const groups = groupByMethodology(REPORTS);
  const seen = new Set(groups.flatMap((g) => g.defs.map((d) => d.id)));
  for (const r of REPORTS) assert.ok(seen.has(r.id), `${r.id} appears under some methodology`);
});

test("artifactsForMethodology bundles reports+views+screens for a methodology (preload set)", () => {
  const agile = artifactsForMethodology("scrum");
  assert.deepEqual(agile.reports.map((r) => r.id), reportsForMethodology("scrum").map((r) => r.id)); // reuses the plane filter
  // reports/views/screens/outputs + notification routes canonical to the methodology.
  assert.ok(Array.isArray(agile.views) && Array.isArray(agile.screens) && Array.isArray(agile.outputs) && Array.isArray(agile.notifications));
  // Scrum lights up its agile reports (burndown/velocity are scrum-tagged in the catalogue).
  assert.ok(agile.reports.some((r) => r.id === "burndown" || r.id === "velocity"), "scrum preloads its agile reports");
});
