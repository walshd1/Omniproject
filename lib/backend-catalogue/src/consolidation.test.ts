import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidateByGroup, consolidationSpec, CONSOLIDATIONS, type ConsolidationInput, type ConsolidationSpec } from "./consolidation";

const income = consolidationSpec("income");

function inputs(...rows: Array<[group: string, currency: string, projected: number, invoiced: number]>): ConsolidationInput[] {
  return rows.map(([g, currency, projected, invoiced]) => ({ groupKey: g, groupLabel: g, currency, values: { projected, invoiced } }));
}

test("shipped specs all validate against the engine's expectations", () => {
  for (const spec of CONSOLIDATIONS) {
    assert.ok(spec.measures.length > 0, `${spec.id} needs measures`);
    for (const d of spec.derived) {
      assert.ok(spec.measures.includes(d.a) && spec.measures.includes(d.b), `${spec.id}.${d.key} references a measure`);
    }
    const sortKeys = [...spec.measures, ...spec.derived.map((d) => d.key)];
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
    measures: ["earnedValue", "actual"],
    derived: [{ key: "cpi", op: "ratioOrNull", a: "earnedValue", b: "actual" }],
    sort: { key: "cpi", dir: "asc" },
  };
  const { total } = consolidateByGroup([{ groupKey: "a", groupLabel: "a", currency: "GBP", values: { earnedValue: 10, actual: 0 } }], spec, "GBP");
  assert.equal(total.metrics["cpi"], null);
});
