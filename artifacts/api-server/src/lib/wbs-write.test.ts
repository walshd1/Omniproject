import { test } from "node:test";
import assert from "node:assert/strict";
import { planWbsWrite } from "./wbs-write";
import type { WbsFieldMapping } from "./wbs-mapping";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";

/**
 * WBS write routing (§4.6): saving semantic values splits each field to its mapped home — sidecar written
 * locally, external handed back (no adapter yet, never dropped).
 */

test("an all-in-one mapping (built-in + sidecar home, declared) routes every field to the sidecar", () => {
  const m: WbsFieldMapping = { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, id: "id", name: "name", budget: "budget", actual: "actual" };
  const plan = planWbsWrite(m, { name: "Platform", budget: 1000, actual: 400 });
  assert.equal(plan.sidecarIdField, "id");
  assert.deepEqual(plan.sidecar, { name: "Platform", budget: 1000, actual: 400 });
  assert.equal(plan.external.length, 0);
  assert.deepEqual(plan.homeless, []);
});

test("a homeless field (no home declared) is surfaced, never written", () => {
  const m: WbsFieldMapping = { id: "id", name: "name", budget: "budget" }; // no home → budget is homeless
  const plan = planWbsWrite(m, { budget: 1000 });
  assert.deepEqual(plan.homeless, ["budget"]);
  assert.deepEqual(plan.sidecar, {});
  assert.equal(plan.external.length, 0);
});

test("a split mapping: sidecar fields written locally, external fields reported (not dropped)", () => {
  const m: WbsFieldMapping = {
    broker: "n8n", backend: "openproject", id: "wpId", name: "subject", joinField: "wbs",
    budget: { backend: "sap", field: "ACDOCA_BUDGET" },                 // external
    actual: { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "ourActual" }, // sidecar
  };
  const plan = planWbsWrite(m, { budget: 1000, actual: 400, name: "Root" });
  assert.equal(plan.sidecarIdField, "wbs");
  assert.deepEqual(plan.sidecar, { ourActual: 400 });                    // only the sidecar-routed field
  // budget → SAP, and name → the OpenProject home; both are external (no adapter yet), reported not dropped.
  assert.equal(plan.external.length, 2);
  assert.ok(plan.external.some((e) => e.key === "budget" && e.target.backend === "sap"));
  assert.ok(plan.external.some((e) => e.key === "name" && e.target.backend === "openproject"));
});

test("an unmapped semantic key is surfaced, not silently written", () => {
  const m: WbsFieldMapping = { id: "id", name: "name" };
  const plan = planWbsWrite(m, { budget: 999 });
  assert.deepEqual(plan.unmapped, ["budget"]);
  assert.deepEqual(plan.sidecar, {});
});
