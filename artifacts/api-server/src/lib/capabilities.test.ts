import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFieldMap } from "./capabilities";
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
