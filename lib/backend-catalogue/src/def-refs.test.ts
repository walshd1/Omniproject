import { test } from "node:test";
import assert from "node:assert/strict";
import { shippedDefs, shippedDefRefs } from "./def-refs";
import { dashboardDefCatalogue } from "./dashboard-preset-catalogue";

/**
 * def-refs — the composition ancestry surface the importer builds its graph from. Tier 1 brought four more
 * shipped kinds into the method (form / dashboard / businessRule / methodology), so a customer can fork any of
 * them and have the ancestry + bidirectional-integrity guard protect the chain. These assert the wiring: every
 * one of those kinds now exposes its shipped defs (full payloads) AND its id/extends refs.
 */

const COMPOSABLE_KINDS = ["primitive", "report", "screen", "mapping", "form", "dashboard", "businessRule", "methodology"];

test("every composable kind exposes shipped defs + refs, each with a logical id", () => {
  for (const kind of COMPOSABLE_KINDS) {
    const defs = shippedDefs(kind);
    const refs = shippedDefRefs(kind);
    assert.ok(defs.length > 0, `${kind} ships at least one def`);
    assert.equal(defs.length, refs.length, `${kind} defs and refs line up 1:1`);
    for (const d of defs) assert.equal(typeof d["id"], "string", `${kind} def has a string id`);
    for (const r of refs) assert.ok(r.id, `${kind} ref has an id`);
  }
});

test("kinds with no shipped catalogue return empty (theme/font/customField/jsonDef)", () => {
  for (const kind of ["theme", "font", "customField", "jsonDef", "nonsense"]) {
    assert.deepEqual(shippedDefs(kind), []);
    assert.deepEqual(shippedDefRefs(kind), []);
  }
});

test("dashboardDefCatalogue produces dashboard DEF payloads (id + name + widgets each with a synthesised id)", () => {
  const defs = dashboardDefCatalogue();
  assert.ok(defs.length > 0);
  for (const d of defs) {
    assert.equal(typeof d.id, "string");
    assert.equal(typeof d.name, "string");
    assert.ok(Array.isArray(d.widgets));
    for (const w of d.widgets) { assert.ok(w.id, "widget has a synthesised id"); assert.ok(w.type, "widget keeps its type"); }
  }
  // The shipped defs the importer sees ARE these payloads — the single source of truth the system store seeds.
  assert.deepEqual(shippedDefs("dashboard"), defs as unknown as Record<string, unknown>[]);
});
