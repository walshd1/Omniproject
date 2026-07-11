import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32, portfolioHealthRows, financeRows, capacityRows, projectRows,
} from "./fixtures.js";

/**
 * The bench fixtures must be DETERMINISTIC (a fixed seed → byte-identical output) and correctly
 * shaped, or the benchmark numbers are meaningless. These assert both.
 */

test("mulberry32 is deterministic and stays in [0, 1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB); // same seed → same sequence
  for (const x of seqA) assert.ok(x >= 0 && x < 1);
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, mulberry32(43))); // different seed → different sequence
});

test("generators produce the requested count and are reproducible for a fixed seed", () => {
  assert.equal(portfolioHealthRows(50).length, 50);
  assert.equal(financeRows(50).length, 50);
  assert.equal(capacityRows(50).length, 50);
  assert.equal(projectRows(50).length, 50);
  // reproducible
  assert.deepEqual(financeRows(10, 7), financeRows(10, 7));
  assert.notDeepEqual(financeRows(10, 7), financeRows(10, 8));
});

test("portfolioHealthRows carry exactly the fields summarizeHealth reads", () => {
  const [r] = portfolioHealthRows(1);
  assert.deepEqual(
    Object.keys(r!).sort(),
    ["activeBlockersCount", "budgetVariancePercentage", "projectId", "projectName", "ragStatus", "scheduleVarianceDays"].sort(),
  );
  assert.ok(["green", "amber", "red"].includes(r!["ragStatus"] as string));
});

test("financeRows are currency-mixed so the FX conversion path is exercised", () => {
  const rows = financeRows(9);
  const currencies = new Set(rows.map((r) => r["currency"]));
  assert.ok(currencies.size > 1, "fixture should span multiple currencies");
  for (const r of rows) assert.equal(typeof r["budgetAllocated"], "number");
});

test("projectRows include standalone (no programme) and grouped projects", () => {
  const rows = projectRows(30);
  const standalone = rows.filter((r) => r["programmeId"] === null);
  const grouped = rows.filter((r) => r["programmeId"] !== null);
  assert.ok(standalone.length > 0, "some projects should be standalone");
  assert.ok(grouped.length > 0, "some projects should belong to a programme");
});
