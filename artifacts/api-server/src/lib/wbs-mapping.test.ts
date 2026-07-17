import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWbsMapping, sanitizeWbsMapping, WbsMappingError, type WbsFieldMapping } from "./wbs-mapping";

/**
 * WBS field mapping (§4.6): the SAP-looking cost screen, populated from ANY backend. These prove the same
 * semantic read model comes out whether the source is OpenProject work packages or a sidecar sheet — "looks
 * like SAP, stored in OpenProject."
 */

// OpenProject-shaped work packages: their own field names, their own money-as-strings.
const openProjectRows = [
  { wpId: "WP-1", subject: "Platform", parentWp: "", statusName: "In progress", costBudget: "£480,000", costSpent: "£312,000", committed: "£52,000", cur: "GBP" },
  { wpId: "WP-1.1", subject: "Core", parentWp: "WP-1", statusName: "In progress", costBudget: "300000", costSpent: "205000", committed: "30000", cur: "GBP" },
];
const openProjectMapping: WbsFieldMapping = {
  id: "wpId", name: "subject", parentId: "parentWp", status: "statusName",
  budget: "costBudget", actual: "costSpent", commitment: "committed", currency: "cur",
};

test("maps OpenProject work packages into the SAME semantic WBS read model the SAP screen consumes", () => {
  const { wbs, financials } = applyWbsMapping(openProjectRows, openProjectMapping, "proj-op");
  // Structure: ids, names, parent nesting + derived level — identical shape to the SAP path.
  assert.deepEqual(wbs.map((w) => w.id), ["WP-1", "WP-1.1"]);
  assert.equal(wbs[0]!.level, 1);
  assert.equal(wbs[1]!.level, 2);       // child of WP-1
  assert.equal(wbs[1]!.parentId, "WP-1");
  assert.equal(wbs[0]!.name, "Platform");
  // Financials: money-as-strings parsed; available = budget − actual − commitment.
  const f = financials["WP-1"]!;
  assert.equal(f.currency, "GBP");
  assert.equal(f.budget, 480000);
  assert.equal(f.actual, 312000);
  assert.equal(f.commitment, 52000);
  assert.equal(f.available, 480000 - 312000 - 52000);
});

test("a different backend's field names produce the identical read model (backend-agnostic)", () => {
  // A sidecar sheet with yet other headers → same output shape as OpenProject/SAP.
  const rows = [{ code: "A", title: "Root", budgetGBP: 1000, spentGBP: 400, poGBP: 100 }];
  const mapping: WbsFieldMapping = { id: "code", name: "title", budget: "budgetGBP", actual: "spentGBP", commitment: "poGBP", currencyDefault: "GBP" };
  const { wbs, financials } = applyWbsMapping(rows, mapping, "proj-x");
  assert.equal(wbs[0]!.id, "A");
  assert.equal(financials["A"]!.currency, "GBP");       // fell back to currencyDefault
  assert.equal(financials["A"]!.available, 1000 - 400 - 100);
});

test("unmapped facets stay empty/zero — nothing is invented", () => {
  const rows = [{ k: "1", n: "Only structure" }];
  const { wbs, financials } = applyWbsMapping(rows, { id: "k", name: "n" }, "p");
  assert.equal(wbs[0]!.status, undefined);
  assert.equal(financials["1"]!.budget, 0);
  assert.equal(financials["1"]!.available, 0);
});

test("sanitize requires id + name and rejects unsafe field names", () => {
  assert.throws(() => sanitizeWbsMapping({ name: "n" }), WbsMappingError);                 // missing id
  assert.throws(() => sanitizeWbsMapping({ id: "__proto__", name: "n" }), WbsMappingError); // forbidden key
  const ok = sanitizeWbsMapping({ id: "wpId", name: "subject", budget: "costBudget", extra: "ignored" });
  assert.deepEqual(ok, { id: "wpId", name: "subject", budget: "costBudget" });
});
