import { test } from "node:test";
import assert from "node:assert/strict";
import { mappingCatalogue, getMappingDef } from "./mapping-catalogue";
import { reportsForMethodology } from "./report-catalogue";
import { screenDefCatalogue } from "./screen-def-catalogue";
import { matchesMethodology } from "./methodology-match";

/**
 * Two invariants for the agile-artifacts build:
 *   (1) mappings are DATA in the JSON catalogue (assets/mappings/), not TS constants — the sprint + epic MODELS
 *       are shipped mapping defs, methodology-NEUTRAL plumbing (a slot is usable anywhere);
 *   (2) the agile SURFACES (sprint board screen, velocity report) are TAGGED as belonging to the iteration
 *       methodologies (scrum/scrumban/safe) — a loose tag, not a hard gate.
 */

const AGILE = ["scrum", "scrumban", "safe"] as const;

test("the sprint + epic + dependency + wbs MODELS ship as JSON mapping defs (no TS constants)", () => {
  const ids = mappingCatalogue().map((m) => m.id).sort();
  for (const id of ["dependencies", "epics", "sprints", "wbs"]) assert.ok(ids.includes(id), `mapping catalogue is missing "${id}"`);
  // The sprint model is the fields the persisted sprint carries — homed on the built-in sidecar by default.
  const sprints = getMappingDef("sprints")!;
  assert.equal(sprints.broker, "builtin");
  assert.equal(sprints.backend, "sidecar");
  assert.deepEqual(Object.keys(sprints.fields).sort(), ["endDate", "goal", "id", "itemIds", "name", "startDate", "state"]);
});

test("the sprint + epic MODELS are methodology-NEUTRAL data (the tag lives on the surfaces, not the slot)", () => {
  for (const id of ["sprints", "epics"]) {
    const def = getMappingDef(id)! as unknown as Record<string, unknown>;
    assert.ok(!("methodologies" in def), `mapping "${id}" must stay methodology-neutral data`);
  }
});

test("the velocity report is TAGGED agile — surfaces under scrum/scrumban/safe, not waterfall/prince2", () => {
  for (const m of AGILE) assert.ok(reportsForMethodology(m).some((r) => r.id === "velocity"), `velocity should belong to ${m}`);
  for (const m of ["waterfall", "prince2"]) assert.ok(!reportsForMethodology(m).some((r) => r.id === "velocity"), `velocity must NOT belong to ${m}`);
});

test("a register screen is PURE JSON: the epics screen is the generic register panel bound to the epics slot", () => {
  const screens = screenDefCatalogue() as unknown as Array<{ id: string; methodologies?: string[]; panels: Array<{ kind: string; config?: { slot?: string } }> }>;
  const epics = screens.find((s) => s.id === "epics")!;
  assert.ok(epics, "the epics register screen should ship");
  // Reuse, not a new primitive: the existing editable `register` panel with a slot source — no bespoke code.
  const panel = epics.panels[0]!;
  assert.equal(panel.kind, "register");
  assert.equal(panel.config?.slot, "epics");
  // The register belongs to agile (a loose tag, usable anywhere the composition enables it).
  for (const m of AGILE) assert.ok(matchesMethodology(epics.methodologies, m), `epics register should belong to ${m}`);
});

test("the sprint board + backlog + burndown SCREENS are TAGGED agile (belong to the iteration methodologies)", () => {
  const screens = screenDefCatalogue() as unknown as Array<{ id: string; methodologies?: string[] }>;
  for (const id of ["sprints", "user-stories", "burndown"]) {
    const s = screens.find((x) => x.id === id)!;
    assert.ok(s, `screen "${id}" should exist`);
    for (const m of AGILE) assert.ok(matchesMethodology(s.methodologies, m), `screen "${id}" should belong to ${m}`);
    assert.ok(!matchesMethodology(s.methodologies, "waterfall"), `screen "${id}" must NOT belong to waterfall`);
  }
});
