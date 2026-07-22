import { test } from "node:test";
import assert from "node:assert/strict";
import { coreWbsMapping, mappingToWbs, DEFAULT_WBS_SLOT } from "./wbs-mapping-resolve";
import { mergeMappings, mappingFromFieldRoutes, type Mapping } from "./mapping";
import { WbsMappingError } from "./wbs-mapping";

/**
 * WBS mapping as a view over the first-class Mapping object (§4.6): the shipped core, overridden per-field by
 * org → … → user (via generic mergeMappings), then adapted to the WbsFieldMapping the projector consumes. The
 * store-backed `resolveWbsMapping` is exercised by the route tests; here we prove the pure adapter + layering.
 */

test("the core mapping adapts to a WbsFieldMapping with the all-in-one defaults", () => {
  const w = mappingToWbs(coreWbsMapping());
  assert.equal(w.id, "id");
  assert.equal(w.name, "name");
  assert.equal(w.currencyDefault, "GBP");
  assert.equal(w.budget, "budget");
  assert.equal(coreWbsMapping().id, DEFAULT_WBS_SLOT);
});

test("a higher scope overrides only the fields it names; structure inherits; adapter keeps refs", () => {
  const org: Mapping = { id: "wbs", fields: { actual: { backend: "sidecar", field: "ourActual" } } };
  const project: Mapping = { id: "wbs", broker: "n8n", backend: "openproject", fields: { budget: { backend: "sap", field: "ACDOCA" } } };
  const w = mappingToWbs(mergeMappings([coreWbsMapping(), org, project]));
  assert.equal(w.id, "id");                                   // structure inherited from core
  assert.equal(w.broker, "n8n");                              // project set the home
  assert.equal(w.backend, "openproject");
  assert.deepEqual(w.actual, { backend: "sidecar", field: "ourActual" }); // org's retarget survived
  assert.deepEqual(w.budget, { backend: "sap", field: "ACDOCA" });        // project's won
});

test("the legacy fieldRouting bridge folds in as a layer (subsumed)", () => {
  const bridge = mappingFromFieldRoutes([{ uiElement: "budget", vendor: "sap", broker: "n8n", sourceField: "ACDOCA_BUDGET" }], "wbs");
  const w = mappingToWbs(mergeMappings([coreWbsMapping(), bridge]));
  assert.deepEqual(w.budget, { broker: "n8n", backend: "sap", field: "ACDOCA_BUDGET" });
});

test("adapting a mapping with no id/name fails — the merge must yield a whole WBS mapping", () => {
  assert.throws(() => mappingToWbs({ id: "wbs", fields: { budget: "b" } }), WbsMappingError);
});
