import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  availabilityFromManifest,
  resolveAvailability,
  __resetAvailabilityCacheForTest,
} from "./availability";

test("availabilityFromManifest: intersects with the superset and honours `populated`", () => {
  const a = availabilityFromManifest({
    tables: ["project", "issue", "not-an-entity"],
    fields: ["title", "status", "dueDate", "notAField"],
    relationships: [
      { from: "issue", field: "programmeId", to: "programme" },
      { from: "issue", field: "notAField", to: "ghost" },
    ],
    populated: ["title", "status"], // dueDate is defined but empty → not surfaced
  });
  assert.equal(a.source, "manifest");
  assert.deepEqual(a.fields, ["title", "status"]); // populated ∩ superset; dueDate + notAField dropped
  assert.deepEqual(a.tables, ["project", "issue"]); // unknown entity dropped
  // only relationships whose field is in the superset survive
  assert.deepEqual(a.relationships, [{ from: "issue", field: "programmeId", to: "programme" }]);
});

test("availabilityFromManifest: with no `populated`, surfaces all manifest fields (∩ superset)", () => {
  const a = availabilityFromManifest({ tables: ["issue"], fields: ["title", "dueDate"], relationships: [] });
  assert.deepEqual(a.fields, ["title", "dueDate"]);
});

test("resolveAvailability: a backend WITHOUT describeSchema falls back cleanly to capability flags", async () => {
  delete process.env["CAPABILITIES"]; // else the env short-circuit pre-empts the broker
  __resetAvailabilityCacheForTest();
  // The default demo broker implements no describeSchema → the resolver must fall back.
  const a = await resolveAvailability({} as Request);
  assert.equal(a.source, "capabilities");
  assert.ok(a.fields.includes("title"), "core fields surface under the capability fallback");
  assert.ok(a.tables.length > 0, "entities surface under the capability fallback");
});
