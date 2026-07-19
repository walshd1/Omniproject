import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidateByGroup, consolidationSpec, CONSOLIDATIONS, type ConsolidationInput, type ConsolidationSpec } from "./consolidation";

const income = consolidationSpec("income");

// The income spec extracts `projected` from item.revenue and `invoiced` from item.invoicedAmount — so a
// test row supplies those raw fields, exactly as a real work item would.
function inputs(...rows: Array<[group: string, currency: string, revenue: number, invoicedAmount: number]>): ConsolidationInput[] {
  return rows.map(([g, currency, revenue, invoicedAmount]) => ({ groupKey: g, groupLabel: g, currency, items: [{ revenue, invoicedAmount }] }));
}

test("shipped specs all validate against the engine's expectations", () => {
  for (const spec of CONSOLIDATIONS) {
    assert.ok(spec.measures.length > 0, `${spec.id} needs measures`);
    const measureKeys = spec.measures.map((m) => m.key);
    // Every measure except `count` (which counts rows, field-free) declares a source field.
    for (const m of spec.measures) assert.ok(m.agg === "count" || m.field, `${spec.id}.${m.key} declares a source field`);
    for (const d of spec.derived) {
      assert.ok(measureKeys.includes(d.a) && measureKeys.includes(d.b), `${spec.id}.${d.key} references a measure`);
    }
    const sortKeys = [...measureKeys, ...spec.derived.map((d) => d.key)];
    assert.ok(sortKeys.includes(spec.sort.key), `${spec.id} sorts on a known key`);
  }
});

test("groups by key, sums measures and computes the derived metrics + grand total", () => {
  const { groups, total } = consolidateByGroup(inputs(["a", "GBP", 100, 40], ["a", "GBP", 100, 60], ["b", "GBP", 50, 50]), income, "GBP");
  const a = groups.find((g) => g.key === "a")!;
  assert.equal(a.metrics["projected"], 200);
  assert.equal(a.metrics["invoiced"], 100);
  assert.equal(a.metrics["unbilled"], 100); // diffFloor0(200, 100)
  assert.equal(a.metrics["billedPct"], 50); // ratioPct(100, 200)
  assert.equal(total.metrics["projected"], 250);
  assert.equal(total.metrics["invoiced"], 150);
});

test("diffFloor0 never goes negative (over-invoiced clamps to 0)", () => {
  const { total } = consolidateByGroup(inputs(["a", "GBP", 100, 130]), income, "GBP");
  assert.equal(total.metrics["unbilled"], 0);
});

test("ratioPct is 0 when the denominator is 0", () => {
  const { total } = consolidateByGroup(inputs(["a", "GBP", 0, 0]), income, "GBP");
  assert.equal(total.metrics["billedPct"], 0);
});

test("sorts by the spec key/dir with a deterministic key tiebreak", () => {
  // income sorts by unbilled DESC; equal unbilled breaks on the group key ascending.
  const { groups } = consolidateByGroup(inputs(["z", "GBP", 100, 0], ["a", "GBP", 100, 0], ["m", "GBP", 300, 0]), income, "GBP");
  assert.deepEqual(groups.map((g) => g.key), ["m", "a", "z"]);
});

test("excludes FX-unconvertible rows from the consolidated total but still counts the project + local figure", () => {
  const rates = { GBP: 1, USD: 1.25 }; // no EUR rate
  const { total } = consolidateByGroup(inputs(["a", "EUR", 100, 50]), income, "GBP", rates);
  assert.equal(total.metrics["projected"], 0, "unconvertible amount not folded into the consolidated total");
  assert.equal(total.excludedForFx, 1);
  assert.equal(total.projects, 1);
  assert.equal(total.localCurrency, "EUR");
  assert.equal(total.local?.["projected"], 100, "raw local figure retained");
});

test("a row that mixes currencies drops its single local figure", () => {
  const rates = { GBP: 1, USD: 1.25 };
  const { total } = consolidateByGroup(inputs(["a", "GBP", 100, 0], ["a", "USD", 100, 0]), income, "GBP", rates);
  assert.equal(total.localCurrency, null);
  assert.equal(total.local, null);
});

test("ratioOrNull yields null when the denominator is 0", () => {
  const spec: ConsolidationSpec = {
    id: "cpi-probe",
    measures: [
      { key: "earnedValue", agg: "sum", field: "ev" },
      { key: "actual", agg: "sum", field: "burn" },
    ],
    derived: [{ key: "cpi", op: "ratioOrNull", a: "earnedValue", b: "actual" }],
    sort: { key: "cpi", dir: "asc" },
  };
  const { total } = consolidateByGroup([{ groupKey: "a", groupLabel: "a", currency: "GBP", items: [{ ev: 10, burn: 0 }] }], spec, "GBP");
  assert.equal(total.metrics["cpi"], null);
});

test("the shipped income/benefits/costs specs are all the same consolidation shape", () => {
  for (const id of ["income", "benefits", "costs"]) {
    const spec = consolidationSpec(id);
    assert.ok(spec.measures.every((m) => m.field), `${id} measures all declare a source field`);
  }
  // costs = sum(budget) + sum(actualCost), variance = budget − actual, pctConsumed = actual/budget%.
  const { total } = consolidateByGroup(
    [{ groupKey: "a", groupLabel: "a", currency: "GBP", items: [{ budget: 1000, actualCost: 600 }, { budget: 500, actualCost: 500 }] }],
    consolidationSpec("costs"),
    "GBP",
  );
  assert.equal(total.metrics["budget"], 1500);
  assert.equal(total.metrics["actual"], 1100);
  assert.equal(total.metrics["variance"], 400);
  assert.equal(total.metrics["pctConsumed"], Math.round((1100 / 1500) * 1000) / 10);
});

test("count / countWhere / ratioPctOrNull power the capacity consolidation", () => {
  const spec = consolidationSpec("capacity");
  const rows = (over: Array<Record<string, number>>) => over;
  const { groups, total } = consolidateByGroup(
    [
      { groupKey: "p1", groupLabel: "P1", currency: "GBP", items: rows([{ allocationPercentage: 120, assignedHours: 40, availableHours: 40 }, { allocationPercentage: 50, assignedHours: 20, availableHours: 40 }]) },
      { groupKey: "p2", groupLabel: "P2", currency: "GBP", items: rows([{ allocationPercentage: 0, assignedHours: 0, availableHours: 0 }]) },
    ],
    spec,
    "GBP",
  );
  const p1 = groups.find((g) => g.key === "p1")!;
  assert.equal(p1.metrics["allocations"], 2); // count of rows
  assert.equal(p1.metrics["overAllocated"], 1); // countWhere allocationPercentage > 100
  assert.equal(p1.metrics["assignedHours"], 60);
  assert.equal(p1.metrics["availableHours"], 80);
  assert.equal(p1.metrics["utilisation"], 75); // ratioPct(60, 80)
  const p2 = groups.find((g) => g.key === "p2")!;
  assert.equal(p2.metrics["utilisation"], null); // no availability ⇒ null, not 0
  // null utilisation sorts to the low end (most-utilised first).
  assert.deepEqual(groups.map((g) => g.key), ["p1", "p2"]);
  assert.equal(total.metrics["allocations"], 3);
});

test("weightedSum applies the per-item weight, its scale, default and clamp", () => {
  // benefits' `expected` = Σ plannedBenefitValue × clamp(confidence,0,100) × 0.01, confidence defaulting to 100.
  const spec: ConsolidationSpec = {
    id: "weighted-probe",
    measures: [{ key: "expected", agg: "weightedSum", field: "planned", weightField: "conf", weightScale: 0.01, weightDefault: 100, weightMax: 100 }],
    derived: [],
    sort: { key: "expected", dir: "asc" },
  };
  const { total } = consolidateByGroup([{
    groupKey: "a", groupLabel: "a", currency: "GBP",
    items: [
      { planned: 100, conf: 50 }, // 100 × 0.5 = 50
      { planned: 100 }, // no conf → default 100 → 100 × 1 = 100
      { planned: 100, conf: 250 }, // clamped to 100 → 100 × 1 = 100
    ],
  }], spec, "GBP");
  assert.equal(total.metrics["expected"], 250);
});
