import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeMapping, mergeMappings, resolveMappingTargets, mappingFromFieldRoutes, mappingHome, MappingError, type Mapping,
} from "./mapping";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";

/**
 * The first-class Mapping object (§4.6): a generic semanticKey → (broker, backend, field) binding, scope-merged
 * per-field, subsuming the org's legacy fieldRouting. Pure shape + resolve + merge.
 */

test("sanitizeMapping requires a slot id and normalises fields + home + defaults", () => {
  const m = sanitizeMapping({
    id: "wbs", broker: "n8n", backend: "openproject", joinField: "wbs",
    fields: { id: "wpId", budget: { backend: "sap", field: "ACDOCA" } },
    defaults: { currency: "GBP" },
  });
  assert.equal(m.id, "wbs");
  assert.deepEqual(mappingHome(m), { broker: "n8n", backend: "openproject" });
  assert.equal(m.fields["id"], "wpId");
  assert.deepEqual(m.fields["budget"], { backend: "sap", field: "ACDOCA" });
  assert.deepEqual(m.defaults, { currency: "GBP" });
});

test("sanitizeMapping accepts a partial override (fields subset, no home) for a scope layer", () => {
  const m = sanitizeMapping({ id: "wbs", fields: { budget: { backend: "sidecar", field: "ourBudget" } } });
  assert.equal(m.id, "wbs");
  assert.deepEqual(Object.keys(m.fields), ["budget"]);
});

test("sanitizeMapping rejects a missing/unsafe slot, unsafe field keys, and unsafe addresses", () => {
  assert.throws(() => sanitizeMapping({ fields: {} }), MappingError);
  assert.throws(() => sanitizeMapping({ id: "__proto__", fields: {} }), MappingError);
  // JSON.parse creates a real own "__proto__" key (the actual injection vector), unlike an object literal.
  assert.throws(() => sanitizeMapping(JSON.parse('{"id":"wbs","fields":{"__proto__":"x"}}')), MappingError);
  assert.throws(() => sanitizeMapping({ id: "wbs", fields: { budget: { backend: "__proto__", field: "x" } } }), MappingError);
});

test("resolveMappingTargets fills the home per field; a bare name inherits the built-in fallback when no home", () => {
  const m = sanitizeMapping({ id: "wbs", fields: { budget: "b", actual: { backend: "sap", field: "a" } } });
  const t = resolveMappingTargets(m);
  assert.deepEqual(t["budget"], { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "b" });
  assert.deepEqual(t["actual"], { broker: BUILTIN_BROKER, backend: "sap", field: "a" }); // broker inherited
});

test("mergeMappings overrides per field, nearest wins; home + defaults merge too", () => {
  const core: Mapping = { id: "wbs", broker: "n8n", backend: "openproject", fields: { id: "wpId", budget: "coreBudget", actual: "coreActual" }, defaults: { currency: "GBP" } };
  const org: Mapping = { id: "wbs", fields: { actual: { backend: "sidecar", field: "ourActual" } } };
  const project: Mapping = { id: "wbs", backend: "sap", fields: { budget: "sapBudget" } };
  const merged = mergeMappings([core, org, project]);
  assert.equal(merged.id, "wbs");
  assert.equal(merged.broker, "n8n");             // inherited from core
  assert.equal(merged.backend, "sap");            // project overrode the home backend
  assert.equal(merged.fields["id"], "wpId");      // untouched
  assert.equal(merged.fields["budget"], "sapBudget");                       // project won
  assert.deepEqual(merged.fields["actual"], { backend: "sidecar", field: "ourActual" }); // org won over core
  assert.deepEqual(merged.defaults, { currency: "GBP" });
});

test("mappingFromFieldRoutes subsumes legacy org routing: uiElement → { broker, backend: vendor, field }", () => {
  const m = mappingFromFieldRoutes(
    [{ uiElement: "budget", vendor: "sap", broker: "n8n", sourceField: "ACDOCA_BUDGET" }],
    "wbs",
  );
  assert.equal(m.id, "wbs");
  assert.deepEqual(m.fields["budget"], { broker: "n8n", backend: "sap", field: "ACDOCA_BUDGET" });
});
