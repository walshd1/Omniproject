import { test } from "node:test";
import assert from "node:assert/strict";
import { rollup, parseRollupQuery } from "./rollup";

/** The one generic, artifact-agnostic roll-up: group ANY rows by ANY field, aggregate ANY metric. */

// Work-item rows — hours logged against a programme (the user's "man-hours by programme" example).
const work = [
  { id: "1", programme: "Apollo", hours: 8, cost: 800 },
  { id: "2", programme: "Apollo", hours: 5, cost: 500 },
  { id: "3", programme: "Gemini", hours: 3, cost: 300 },
  { id: "4", programme: "Gemini", hours: 7, cost: 700 },
  { id: "5", programme: null, hours: 2, cost: 100 },
];

test("man-hours by programme = one generic call (groupBy programme, sum hours)", () => {
  const r = rollup(work, { groupBy: "programme", metrics: [{ field: "hours", agg: "sum" }] });
  assert.deepEqual(r, [
    { programme: "Apollo", count: 2, hours: 13 },
    { programme: "Gemini", count: 2, hours: 10 },
    { programme: "—", count: 1, hours: 2 }, // null groups under "—"
  ]);
});

test("multiple metrics + count, sorted by the first metric desc", () => {
  const r = rollup(work, { groupBy: "programme", metrics: [{ field: "cost", agg: "sum", as: "totalCost" }, { field: "hours", agg: "avg" }] });
  assert.equal(r[0]!["programme"], "Apollo");
  assert.equal(r[0]!["totalCost"], 1300);
  assert.equal(r[0]!["hours"], 6.5); // avg of 8,5
});

test("every agg works", () => {
  const one = (agg: "sum" | "avg" | "count" | "min" | "max") => rollup(work, { groupBy: "programme", metrics: [{ field: "hours", agg }] }).find((x) => x["programme"] === "Apollo")!;
  assert.equal(one("sum")["hours"], 13);
  assert.equal(one("min")["hours"], 5);
  assert.equal(one("max")["hours"], 8);
  assert.equal(one("count")["count"], 2);
});

test("pivot: groupBy2 spreads the metric across columns", () => {
  const rows = [
    { team: "A", quarter: "Q1", hours: 10 },
    { team: "A", quarter: "Q2", hours: 20 },
    { team: "B", quarter: "Q1", hours: 5 },
  ];
  const r = rollup(rows, { groupBy: "team", groupBy2: "quarter", metrics: [{ field: "hours", agg: "sum" }] });
  const a = r.find((x) => x["team"] === "A")!;
  assert.equal(a["Q1 · hours"], 10);
  assert.equal(a["Q2 · hours"], 20);
  const b = r.find((x) => x["team"] === "B")!;
  assert.equal(b["Q1 · hours"], 5);
  assert.equal(b["Q2 · hours"], 0); // absent cell → 0
});

test("parseRollupQuery parses the compact spec; null without groupBy", () => {
  assert.equal(parseRollupQuery({}), null);
  assert.deepEqual(parseRollupQuery({ groupBy: "programme", metric: "sum:hours,avg:cost" }), {
    groupBy: "programme", metrics: [{ agg: "sum", field: "hours" }, { agg: "avg", field: "cost" }],
  });
});
