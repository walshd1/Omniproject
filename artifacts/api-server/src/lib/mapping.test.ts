import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeMapping, mergeMappings, resolveMappingTargets, mappingFromFieldRoutes, mappingHome,
  projectMappingRows, planMappingWrite, MappingError, type Mapping,
} from "./mapping";
import { BUILTIN_BROKER, SIDECAR_BACKEND, targetKey } from "./field-target";

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

test("resolveMappingTargets resolves against the declared home and surfaces homeless fields (no silent default)", () => {
  // No home declared: a bare name is HOMELESS; a field naming only a backend is still homeless (broker missing).
  const homeless = resolveMappingTargets(sanitizeMapping({ id: "wbs", fields: { budget: "b", actual: { backend: "sap", field: "a" } } }));
  assert.deepEqual(homeless.targets, {});
  assert.deepEqual([...homeless.homeless].sort(), ["actual", "budget"]);

  // With a declared home: bare names inherit it; a field can still route elsewhere (broker inherited from home).
  const m = sanitizeMapping({ id: "wbs", broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, fields: { budget: "b", actual: { backend: "sap", field: "a" } } });
  const t = resolveMappingTargets(m);
  assert.deepEqual(t.homeless, []);
  assert.deepEqual(t.targets["budget"], { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "b" });
  assert.deepEqual(t.targets["actual"], { broker: BUILTIN_BROKER, backend: "sap", field: "a" }); // broker inherited
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

test("projectMappingRows projects any surface's rows (id + semantic values) from a bare home bucket", () => {
  const m = sanitizeMapping({ id: "risk", broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, fields: { id: "rid", title: "subject", severity: "sev" } });
  const rows = projectMappingRows([{ rid: "R-1", subject: "Data loss", sev: "high" }], m);
  assert.deepEqual(rows, [{ id: "R-1", title: "Data loss", severity: "high" }]);
});

test("projectMappingRows returns nothing when the structure is homeless (no declared home)", () => {
  const m = sanitizeMapping({ id: "risk", fields: { id: "rid", title: "subject" } });
  assert.deepEqual(projectMappingRows([{ rid: "R-1", subject: "x" }], m), []);
});

test("projectMappingRows joins a non-home bucket by id (a field sourced from another backend)", () => {
  const m = sanitizeMapping({
    id: "risk", broker: "n8n", backend: "jira",
    // owner routes to the built-in sidecar (broker AND backend named — "sidecar" alone would inherit the jira home).
    fields: { id: "key", title: "summary", owner: { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "assignedTo" } },
    joinField: "key",
  });
  const buckets = {
    [targetKey({ broker: "n8n", backend: "jira" })]: [{ key: "R-1", summary: "Outage" }],
    [targetKey({ broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND })]: [{ key: "R-1", assignedTo: "Dana" }],
  };
  assert.deepEqual(projectMappingRows(buckets, m), [{ id: "R-1", title: "Outage", owner: "Dana" }]);
});

test("planMappingWrite splits a generic write: sidecar written, external reported, id skipped", () => {
  const m = sanitizeMapping({
    id: "risk", broker: "n8n", backend: "jira",
    fields: { id: "key", title: "summary", owner: { broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, field: "assignedTo" } },
  });
  const plan = planMappingWrite(m, { id: "R-1", title: "Outage", owner: "Dana" });
  assert.deepEqual(plan.sidecar, { assignedTo: "Dana" });   // sidecar-routed
  assert.equal(plan.external.length, 1);                     // title → the Jira home (external)
  assert.equal(plan.external[0]!.key, "title");
});
