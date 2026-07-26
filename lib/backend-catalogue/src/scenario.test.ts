import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreScenario, compareScenarios } from "./scenario";

test("canonical DCF vector: NPV, PV split, ROI, BCR, payback", () => {
  // [-100, 60, 60] at 10%: PV inflows = 60/1.1 + 60/1.21 = 104.13; NPV = 4.13.
  const s = scoreScenario({ id: "a", cashFlows: [-100, 60, 60] }, 0.1);
  assert.equal(s.npv, 4.13);
  assert.equal(s.pvInflows, 104.13);
  assert.equal(s.pvOutflows, 100);
  assert.equal(s.roi, 0.2); // undiscounted (120 - 100) / 100
  assert.equal(s.benefitCostRatio, 1.0413); // 104.13 / 100 discounted
  assert.equal(s.paybackPeriod, 2); // cumulative -100, -40, +20 ⇒ recovers at period 2
});

test("discounting reduces NPV vs the undiscounted net", () => {
  const undiscounted = scoreScenario({ id: "a", cashFlows: [-100, 60, 60] }, 0);
  const discounted = scoreScenario({ id: "a", cashFlows: [-100, 60, 60] }, 0.1);
  assert.equal(undiscounted.npv, 20); // -100 + 60 + 60
  assert.ok(discounted.npv < undiscounted.npv);
});

test("compareScenarios ranks by NPV descending", () => {
  const { ranked } = compareScenarios(
    [
      { id: "steady", cashFlows: [-100, 60, 60] }, // NPV 4.13 @10%
      { id: "front-loaded", cashFlows: [-100, 130] }, // NPV 18.18 @10%
    ],
    { discountRate: 0.1 },
  );
  assert.deepEqual(ranked.map((r) => r.id), ["front-loaded", "steady"]);
});

test("cost/benefits convenience form equals the explicit cashFlows form", () => {
  const convenience = scoreScenario({ id: "a", cost: 100, benefits: [60, 60] }, 0);
  const explicit = scoreScenario({ id: "a", cashFlows: [-100, 60, 60] }, 0);
  assert.deepEqual(convenience, explicit);
  assert.equal(convenience.npv, 20);
});

test("no outflow ⇒ roi and benefitCostRatio are null (never Infinity)", () => {
  const s = scoreScenario({ id: "all-upside", cashFlows: [10, 50] }, 0);
  assert.equal(s.roi, null);
  assert.equal(s.benefitCostRatio, null);
  assert.equal(Number.isFinite(s.npv), true);
  assert.equal(s.paybackPeriod, 0); // already non-negative at period 0
});

test("a scenario that never recovers its cost has a null payback period", () => {
  const s = scoreScenario({ id: "sink", cashFlows: [-100, 10, 10] }, 0);
  assert.equal(s.paybackPeriod, null);
  assert.equal(s.npv, -80);
});

test("a nonsensical discount rate (≤ -100%) falls back to undiscounted, no divide-by-zero", () => {
  const s = scoreScenario({ id: "a", cashFlows: [-100, 60, 60] }, -1);
  assert.equal(s.npv, 20); // treated as rate 0
  assert.equal(Number.isFinite(s.npv), true);
});

test("equal NPV is broken deterministically by id ascending", () => {
  const { ranked } = compareScenarios([
    { id: "zulu", cashFlows: [-50, 60] },
    { id: "alpha", cashFlows: [-50, 60] },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ["alpha", "zulu"]);
});

test("dirty / non-finite cash flows are coerced to finite numbers, never NaN", () => {
  const s = scoreScenario({ id: "dirty", cashFlows: [-100, "60" as unknown as number, NaN as unknown as number] }, 0);
  assert.equal(s.npv, -40); // -100 + 60 + 0
  assert.equal(Number.isFinite(s.npv), true);
});

test("empty input ⇒ empty ranking", () => {
  assert.deepEqual(compareScenarios([]).ranked, []);
});
