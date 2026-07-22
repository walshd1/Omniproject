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
  assert.equal(map.entities.programme!.surface, true);
});

test("deriveFieldMap: no scheduling ⇒ dates not surfaced", () => {
  const map = deriveFieldMap({ ...ALL, scheduling: false });
  assert.equal(map.fields.startDate!.surface, false);
  assert.equal(map.fields.dueDate!.surface, false);
  // unrelated fields unaffected
  assert.equal(map.fields.title!.surface, true);
});

test("deriveFieldMap: no portfolio ⇒ programme entity unsupported", () => {
  const map = deriveFieldMap({ ...ALL, portfolio: false });
  assert.equal(map.entities.programme!.surface, false);
  assert.equal(map.fields.programmeId!.surface, false);
});

test("deriveFieldMap: strategy fields (KPIs/goals) are portfolio-tier (project + programme)", () => {
  // With portfolio on, the strategic-alignment fields surface so a project or
  // programme can show which goals/KPIs it relates to.
  const on = deriveFieldMap(ALL);
  assert.equal(on.fields.strategicGoals!.surface, true);
  assert.equal(on.fields.kpis!.surface, true);
  assert.equal(on.fields.objectives!.surface, true);
  // …and they go dark when the backend has no portfolio capability.
  const off = deriveFieldMap({ ...ALL, portfolio: false });
  assert.equal(off.fields.strategicGoals!.surface, false);
  assert.equal(off.fields.kpis!.surface, false);
});

test("deriveFieldMap: benefits fields gate on the dedicated benefits domain", () => {
  // The benefits-realisation group surfaces only when the backend declares it can
  // carry benefits — independent of the portfolio rollup.
  const on = deriveFieldMap({ ...ALL, benefits: true });
  assert.equal(on.fields.plannedBenefitValue!.surface, true);
  assert.equal(on.fields.actualBenefitValue!.surface, true);
  assert.equal(on.fields.benefitStatus!.store, true);
  // …and go dark without the benefits domain.
  const off = deriveFieldMap({ ...ALL, benefits: false });
  assert.equal(off.fields.plannedBenefitValue!.surface, false);
  assert.equal(off.fields.benefitOwner!.surface, false);
});

test("deriveFieldMap: stakeholder fields + entity gate on the stakeholders domain", () => {
  const on = deriveFieldMap({ ...ALL, stakeholders: true });
  assert.equal(on.fields.stakeholderName!.surface, true);
  assert.equal(on.fields.influence!.surface, true);
  assert.equal(on.fields.commsCadence!.store, true);
  assert.equal(on.entities.stakeholder!.surface, true);
  // …and go dark without the stakeholders domain.
  const off = deriveFieldMap({ ...ALL, stakeholders: false });
  assert.equal(off.fields.stakeholderName!.surface, false);
  assert.equal(off.entities.stakeholder!.surface, false);
});

test("deriveFieldMap: RACI fields + entity gate on the raci domain", () => {
  const on = deriveFieldMap({ ...ALL, raci: true });
  assert.equal(on.fields.deliverable!.surface, true);
  assert.equal(on.fields.raciAccountable!.surface, true);
  assert.equal(on.entities.raci!.surface, true);
  const off = deriveFieldMap({ ...ALL, raci: false });
  assert.equal(off.fields.raciResponsible!.surface, false);
  assert.equal(off.entities.raci!.surface, false);
});

test("deriveFieldMap: risk-register fields extend RAID (ride the raid domain, not a duplicate)", () => {
  const on = deriveFieldMap({ ...ALL, raid: true });
  assert.equal(on.fields.probability!.surface, true);
  assert.equal(on.fields.riskExposure!.surface, true);
  assert.equal(on.fields.responseStrategy!.store, true);
  const off = deriveFieldMap({ ...ALL, raid: false });
  assert.equal(off.fields.probability!.surface, false);
  assert.equal(off.fields.responseStrategy!.surface, false);
});

test("deriveFieldMap: task fields + entity ride the issues domain (task apps declare it)", () => {
  const on = deriveFieldMap({ ...ALL, issues: true });
  assert.equal(on.fields.context!.surface, true);
  assert.equal(on.fields.energy!.surface, true);
  assert.equal(on.fields.reminderAt!.store, true);
  assert.equal(on.fields.collaborators!.surface, true);
  assert.equal(on.entities.task!.surface, true);
  // …and go dark for a backend with no work-item (issues) domain at all.
  const off = deriveFieldMap({ ...ALL, issues: false });
  assert.equal(off.fields.energy!.surface, false);
  assert.equal(off.entities.task!.surface, false);
});

test("deriveFieldMap: CapEx/OpEx split + cost category ride the financials domain", () => {
  const on = deriveFieldMap({ ...ALL, financials: true });
  assert.equal(on.fields.expenditureType!.surface, true);
  assert.equal(on.fields.capexAmount!.surface, true);
  assert.equal(on.fields.opexAmount!.surface, true);
  assert.equal(on.fields.costCategory!.store, true);
  const off = deriveFieldMap({ ...ALL, financials: false });
  assert.equal(off.fields.capexAmount!.surface, false);
  assert.equal(off.fields.expenditureType!.surface, false);
});

test("deriveFieldMap: project is read-through by default (surface, no store)", () => {
  const map = deriveFieldMap(ALL);
  assert.deepEqual(map.entities.project, { surface: true, store: false });
});

test("DemoBroker.fieldMap: everything supported except read-only completionPct", async () => {
  const map = await new DemoBroker().fieldMap();
  assert.equal(map.fields.storyPoints!.store, true);
  assert.equal(map.fields.completionPct!.surface, true);
  assert.equal(map.fields.completionPct!.store, false);
  assert.equal(map.entities.programme!.store, true);
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

test("resolveCapabilities: per-field lineage (fieldSources) from the describe", async () => {
  delete process.env["CAPABILITIES"];
  const caps = await resolveCapabilities({} as Request);
  // The system label is data-driven (default backendSource "all" → neutral
  // "backend"); the native field name comes from the broker's describe.
  assert.equal(caps.fieldSources?.["dueDate"]?.system, "backend");
  assert.equal(caps.fieldSources?.["dueDate"]?.field, "duedate");
  assert.equal(caps.fieldSources?.["customerTier"]?.field, "customfield_10200");
});

test("resolveFieldManifest: reconciles the demo describe against the registry", async () => {
  const m = await resolveFieldManifest({} as Request);
  assert.ok(m.reconciliation.known.length > 0, "canonical fields are known");
  assert.equal(m.reconciliation.missing.length, 0, "demo exposes the whole registry");
  assert.ok(m.reconciliation.unknown.includes("customerTier"));
  assert.equal(m.customFields.length, 3); // customerTier, riskScore, contactEmail
  assert.ok(m.customFields.every((f) => f.label && f.type));
});
