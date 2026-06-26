import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { deriveFieldMap, resolveCapabilities, resolveFieldManifest } from "./capabilities";
import { DemoBroker } from "../broker/demo";

const ALL = {
  issues: true,
  scheduling: true,
  resources: true,
  financials: true,
  portfolio: true,
  baseline: true,
  blockers: true,
  history: true,
  raid: true,
};

test("deriveFieldMap: full domains surface every field; rolled-up values are read-only", () => {
  const map = deriveFieldMap(ALL);
  assert.deepEqual(map.fields.title, { surface: true, store: true });
  assert.deepEqual(map.fields.dueDate, { surface: true, store: true });
  // completionPct is derived/rolled up → surface but not store
  assert.deepEqual(map.fields.completionPct, { surface: true, store: false });
  assert.equal(map.entities.programme.surface, true);
});

test("deriveFieldMap: no scheduling ⇒ dates not surfaced", () => {
  const map = deriveFieldMap({ ...ALL, scheduling: false });
  assert.equal(map.fields.startDate.surface, false);
  assert.equal(map.fields.dueDate.surface, false);
  // unrelated fields unaffected
  assert.equal(map.fields.title.surface, true);
});

test("deriveFieldMap: no portfolio ⇒ programme entity unsupported", () => {
  const map = deriveFieldMap({ ...ALL, portfolio: false });
  assert.equal(map.entities.programme.surface, false);
  assert.equal(map.fields.programmeId.surface, false);
});

test("deriveFieldMap: project is read-through by default (surface, no store)", () => {
  const map = deriveFieldMap(ALL);
  assert.deepEqual(map.entities.project, { surface: true, store: false });
});

test("DemoBroker.fieldMap: everything supported except read-only completionPct", async () => {
  const map = await new DemoBroker().fieldMap();
  assert.equal(map.fields.storyPoints.store, true);
  assert.equal(map.fields.completionPct.surface, true);
  assert.equal(map.fields.completionPct.store, false);
  assert.equal(map.entities.programme.store, true);
});

test("resolveCapabilities: the describe→reconcile path auto-surfaces custom fields", async () => {
  delete process.env["CAPABILITIES"]; // else env short-circuits before the broker
  const caps = await resolveCapabilities({} as Request);
  const keys = (caps.customFields ?? []).map((f) => f.key);
  assert.ok(keys.includes("customerTier"), "discovers a non-canonical field");
  assert.ok(keys.includes("riskScore"));
  // Discovering customs flips the passthrough entity on (surface).
  assert.equal(caps.entities["customField"]?.surface, true);
  // A canonical field is NOT treated as a custom field.
  assert.ok(!keys.includes("title"));
});

test("resolveFieldManifest: reconciles the demo describe against the registry", async () => {
  const m = await resolveFieldManifest({} as Request);
  assert.ok(m.reconciliation.known.length > 0, "canonical fields are known");
  assert.equal(m.reconciliation.missing.length, 0, "demo exposes the whole registry");
  assert.ok(m.reconciliation.unknown.includes("customerTier"));
  assert.equal(m.customFields.length, 2);
  assert.ok(m.customFields.every((f) => f.label && f.type));
});
