import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeBenefitRealisation, type BenefitRecord } from "./benefit-realisation";

const DAY = 86_400_000;
const NOW = 20_000 * DAY;

test("computes per-benefit variance, variance %, realisation ratio", () => {
  const benefits: BenefitRecord[] = [
    { id: "a", plannedValue: 100, actualValue: 60, status: "realising", category: "financial" },
  ];
  const { benefits: scored } = analyzeBenefitRealisation(benefits, { now: NOW });
  const b = scored[0]!;
  assert.equal(b.planned, 100);
  assert.equal(b.actual, 60);
  assert.equal(b.variance, -40);
  assert.equal(b.variancePct, -40);
  assert.equal(b.realisationRatio, 0.6);
  assert.equal(b.classification, "on_track"); // not overdue, not realised
});

test("classifies realised (status or actual>=planned), abandoned, overdue, on_track", () => {
  const benefits: BenefitRecord[] = [
    { id: "realised-status", plannedValue: 100, actualValue: 50, status: "realised" },
    { id: "realised-value", plannedValue: 100, actualValue: 100, status: "realising" },
    { id: "abandoned", plannedValue: 100, actualValue: 0, status: "abandoned" },
    { id: "overdue", plannedValue: 100, actualValue: 20, status: "realising", dueDate: NOW - DAY },
    { id: "ontrack", plannedValue: 100, actualValue: 20, status: "realising", dueDate: NOW + DAY },
  ];
  const cls = (id: string, r: ReturnType<typeof analyzeBenefitRealisation>) => r.benefits.find((b) => b.id === id)!.classification;
  const r = analyzeBenefitRealisation(benefits, { now: NOW });
  assert.equal(cls("realised-status", r), "realised");
  assert.equal(cls("realised-value", r), "realised");
  assert.equal(cls("abandoned", r), "abandoned");
  assert.equal(cls("overdue", r), "overdue");
  assert.equal(cls("ontrack", r), "on_track");
  assert.equal(r.summary.realised, 2);
  assert.equal(r.summary.abandoned, 1);
  assert.equal(r.summary.overdue, 1);
  assert.equal(r.summary.onTrack, 1);
});

test("portfolio roll-up: totals, overall ratio, realised vs outstanding value", () => {
  const benefits: BenefitRecord[] = [
    { id: "a", plannedValue: 100, actualValue: 100, status: "realised" },
    { id: "b", plannedValue: 300, actualValue: 60, status: "realising" },
  ];
  const { summary } = analyzeBenefitRealisation(benefits, { now: NOW });
  assert.equal(summary.totalPlanned, 400);
  assert.equal(summary.totalActual, 160);
  assert.equal(summary.totalVariance, -240);
  assert.equal(summary.overallRealisationRatio, 0.4);
  assert.equal(summary.realisedValue, 100); // actual on the realised benefit
  assert.equal(summary.outstandingValue, 240); // 400 - 160
});

test("rolls up by category and by status", () => {
  const benefits: BenefitRecord[] = [
    { id: "a", plannedValue: 100, actualValue: 50, category: "financial", status: "realising" },
    { id: "b", plannedValue: 100, actualValue: 100, category: "financial", status: "realised" },
    { id: "c", plannedValue: 50, actualValue: 0, category: "revenue", status: "planned" },
  ];
  const { byCategory, byStatus } = analyzeBenefitRealisation(benefits, { now: NOW });
  const fin = byCategory.find((c) => c.category === "financial")!;
  assert.equal(fin.planned, 200);
  assert.equal(fin.actual, 150);
  assert.equal(fin.realisationRatio, 0.75);
  assert.equal(fin.count, 2);
  assert.equal(byStatus.realising, 1);
  assert.equal(byStatus.realised, 1);
  assert.equal(byStatus.planned, 1);
});

test("worst-realisation sorts first; a no-plan benefit sorts last", () => {
  const benefits: BenefitRecord[] = [
    { id: "half", plannedValue: 100, actualValue: 50 }, // 0.5
    { id: "tenth", plannedValue: 100, actualValue: 10 }, // 0.1
    { id: "noplan", plannedValue: 0, actualValue: 30 }, // null ratio ⇒ last
  ];
  const { benefits: scored } = analyzeBenefitRealisation(benefits, { now: NOW });
  assert.deepEqual(scored.map((b) => b.id), ["tenth", "half", "noplan"]);
  assert.equal(scored[2]!.realisationRatio, null);
});

test("guarded divides: planned 0 ⇒ null ratio + null variance %, never NaN", () => {
  const { benefits, summary } = analyzeBenefitRealisation([{ id: "a", plannedValue: 0, actualValue: 5 }], { now: NOW });
  assert.equal(benefits[0]!.realisationRatio, null);
  assert.equal(benefits[0]!.variancePct, null);
  assert.equal(summary.overallRealisationRatio, null);
});

test("empty ⇒ empty", () => {
  const r = analyzeBenefitRealisation([], { now: NOW });
  assert.deepEqual(r.benefits, []);
  assert.deepEqual(r.byCategory, []);
  assert.deepEqual(r.summary, {
    total: 0, realised: 0, abandoned: 0, overdue: 0, onTrack: 0,
    totalPlanned: 0, totalActual: 0, totalVariance: 0, overallRealisationRatio: null,
    realisedValue: 0, outstandingValue: 0,
  });
});

test("malformed input tolerated: non-objects dropped, ids coerced, dirty values ⇒ 0, never throws", () => {
  const dirty = [
    null,
    42,
    { id: 7, plannedValue: "xyz", actualValue: 10 }, // numeric id; dirty planned ⇒ 0
    { id: "  ", plannedValue: 100 }, // blank id dropped
    { id: "bad-due", plannedValue: 100, actualValue: 10, dueDate: "not-a-date" }, // dirty due ⇒ not overdue
  ] as unknown as BenefitRecord[];
  const { benefits, summary } = analyzeBenefitRealisation(dirty, { now: NOW });
  assert.equal(summary.total, 2); // "7" and "bad-due"
  assert.equal(benefits.find((b) => b.id === "7")!.planned, 0);
  assert.equal(benefits.find((b) => b.id === "bad-due")!.overdue, false);
});

test("deterministic: same input ⇒ identical output", () => {
  const benefits: BenefitRecord[] = [{ id: "a", plannedValue: 100, actualValue: 40 }, { id: "b", plannedValue: 200, actualValue: 200, status: "realised" }];
  assert.deepEqual(analyzeBenefitRealisation(benefits, { now: NOW }), analyzeBenefitRealisation(benefits, { now: NOW }));
});
