import { test } from "node:test";
import assert from "node:assert/strict";
import { seedDemoProgrammeRegistry } from "./app";
import { getSettings, updateSettings } from "./lib/settings";
import { SAMPLE_PROGRAMME_REGISTRY, SAMPLE_PROJECTS } from "./broker/demo-data";
import { groupProgrammes, programmeDetail } from "./lib/programmes";

/**
 * Demo mode must be internally consistent: programme membership is registry-driven (by project
 * correlation GUID), so without a seeded registry the sample projects roll up into ZERO programmes
 * and every programme page 404s. These tests pin the seed + the resulting roll-up. Tests run with
 * no BROKER_URL, so the active broker is the demo broker (brokerKind === "demo").
 */

test("seedDemoProgrammeRegistry populates an empty registry from the demo projects", () => {
  updateSettings({ programmeRegistry: {} });
  seedDemoProgrammeRegistry();
  assert.deepEqual(getSettings().programmeRegistry, SAMPLE_PROGRAMME_REGISTRY);
});

test("seedDemoProgrammeRegistry never clobbers an operator-configured registry", () => {
  const operator = { "prog-x": { name: "Operator Programme", instanceIds: ["demo-guid-proj-001"] } };
  updateSettings({ programmeRegistry: operator });
  seedDemoProgrammeRegistry();
  assert.deepEqual(getSettings().programmeRegistry, operator);
  updateSettings({ programmeRegistry: {} }); // restore for other tests
});

test("the seeded registry groups the sample projects into two named programmes", () => {
  updateSettings({ programmeRegistry: {} });
  seedDemoProgrammeRegistry();
  const registry = getSettings().programmeRegistry;

  const programmes = groupProgrammes(SAMPLE_PROJECTS, registry);
  const ids = programmes.map((p) => p.id).sort();
  assert.deepEqual(ids, ["prog-platform", "prog-security"]);

  const platform = programmeDetail(SAMPLE_PROJECTS, "prog-platform", registry);
  assert.ok(platform, "prog-platform must resolve");
  assert.equal(platform!.name, "Platform Modernization");
  assert.equal(platform!.projects.length, 2); // proj-001 + proj-002

  // proj-004 is deliberately standalone — in no programme.
  assert.equal(programmeDetail(SAMPLE_PROJECTS, "prog-missing", registry), null);
});
