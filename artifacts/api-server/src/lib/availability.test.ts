import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  availabilityFromManifest,
  applyCuration,
  resolveAvailability,
  __resetAvailabilityCacheForTest,
} from "./availability";

test("availabilityFromManifest: intersects with the superset and honours `populated`", () => {
  const b = availabilityFromManifest({
    tables: ["project", "issue", "not-an-entity"],
    fields: ["title", "status", "dueDate", "notAField"],
    relationships: [
      { from: "issue", field: "programmeId", to: "programme" },
      { from: "issue", field: "notAField", to: "ghost" },
    ],
    populated: ["title", "status"], // dueDate is defined but empty → not surfaced
  });
  assert.equal(b.source, "manifest");
  assert.deepEqual(b.available, ["title", "status"]); // populated ∩ superset; dueDate + notAField dropped
  assert.deepEqual(b.tables, ["project", "issue"]); // unknown entity dropped
  assert.deepEqual(b.relationships, [{ from: "issue", field: "programmeId", to: "programme" }]);
});

test("applyCuration: hides only available fields, leaving the rest; reports the effective hidden set", () => {
  const backend = {
    source: "manifest" as const,
    available: ["title", "status", "dueDate"],
    tables: ["issue"],
    relationships: [{ from: "issue", field: "dueDate", to: "x" }],
  };
  // Hide dueDate (available) + a field that isn't available — the latter is ignored.
  const a = applyCuration(backend, ["dueDate", "notAvailable"]);
  assert.deepEqual(a.fields, ["title", "status"]); // dueDate curated out
  assert.deepEqual(a.available, ["title", "status", "dueDate"]); // full set preserved for the panel
  assert.deepEqual(a.hidden, ["dueDate"]); // only the actually-available hidden field
  assert.deepEqual(a.relationships, []); // a relationship on a hidden field is dropped too
});

test("availabilityFromManifest: no populated → uses `fields`; missing tables/relationships default to []", () => {
  const b = availabilityFromManifest({ fields: ["title", "status"] } as never);
  assert.deepEqual(b.available, ["title", "status"]); // fields used when populated absent
  assert.deepEqual(b.tables, []); // m.tables ?? []
  assert.deepEqual(b.relationships, []); // m.relationships ?? []
});

test("resolveAvailability: a second call within the TTL is served from the cache", async () => {
  delete process.env["CAPABILITIES"];
  __resetAvailabilityCacheForTest();
  const first = await resolveAvailability({} as Request);
  const second = await resolveAvailability({} as Request); // cache-hit branch (no re-resolve)
  assert.deepEqual(second.available, first.available);
  assert.equal(second.source, first.source);
});

test("resolveAvailability: a backend WITHOUT describeSchema falls back to capability flags", async () => {
  delete process.env["CAPABILITIES"]; // else the env short-circuit pre-empts the broker
  __resetAvailabilityCacheForTest();
  // The default demo broker implements no describeSchema → the resolver must fall back.
  const a = await resolveAvailability({} as Request);
  assert.equal(a.source, "capabilities");
  assert.ok(a.fields.includes("title"), "core fields surface under the capability fallback");
  assert.ok(a.available.includes("title"), "the available set is reported alongside the net set");
  assert.ok(a.tables.length > 0, "entities surface under the capability fallback");
});
