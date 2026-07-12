import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProgrammeRegistry,
  programmeIdsOf,
  groupProgrammes,
  programmeDetail,
  standaloneCount,
  ProgrammeRegistryError,
  type ProgrammeRegistry,
} from "./programmes";
import type { Row } from "./data";

const proj = (over: Row): Row => ({ issueCount: 0, completedCount: 0, ...over });
const registry: ProgrammeRegistry = {
  "prog-apollo": { name: "Apollo Programme", instanceIds: ["guid-1", "guid-2"] },
  "prog-zephyr": { name: "Zephyr", instanceIds: ["guid-3"] },
};

test("validateProgrammeRegistry normalises: default name to id, dedupe/trim GUIDs", () => {
  const ok = validateProgrammeRegistry({ p1: { name: " Alpha ", instanceIds: [" g1 ", "g1", "", "g2"] }, p2: { instanceIds: ["g3"] } });
  assert.deepEqual(ok["p1"], { name: "Alpha", instanceIds: ["g1", "g2"] });
  assert.deepEqual(ok["p2"], { name: "p2", instanceIds: ["g3"] }); // name defaults to the id
});

test("validateProgrammeRegistry rejects bad shapes", () => {
  assert.throws(() => validateProgrammeRegistry([]), ProgrammeRegistryError);
  assert.throws(() => validateProgrammeRegistry({ "": { instanceIds: [] } }), /non-empty/);
  assert.throws(() => validateProgrammeRegistry({ p: { name: "x" } }), /instanceIds array/);
});

test("membership is by correlation GUID, not programmeId — a project can be in several programmes", () => {
  assert.deepEqual(programmeIdsOf(proj({ id: "a", omniInstanceId: "guid-1", programmeId: "ignored" }), registry), ["prog-apollo"]);
  assert.deepEqual(programmeIdsOf(proj({ id: "b", omniInstanceId: "guid-x" }), registry), []); // GUID not in any list
  const shared: ProgrammeRegistry = { p1: { name: "P1", instanceIds: ["g"] }, p2: { name: "P2", instanceIds: ["g"] } };
  assert.deepEqual(programmeIdsOf(proj({ id: "c", omniInstanceId: "g" }), shared).sort(), ["p1", "p2"]);
  // A backend programmeId no longer confers membership on its own.
  assert.deepEqual(programmeIdsOf(proj({ id: "d", programmeId: "prog-apollo" }), registry), []);
});

test("groupProgrammes groups by the registry and names from it", () => {
  const projects = [
    proj({ id: "a", omniInstanceId: "guid-1", issueCount: 4, completedCount: 2 }),
    proj({ id: "b", omniInstanceId: "guid-2", issueCount: 6, completedCount: 3 }),
    proj({ id: "c", omniInstanceId: "guid-3" }),
    proj({ id: "d", omniInstanceId: "guid-x" }), // standalone
  ];
  const groups = groupProgrammes(projects, registry);
  assert.equal(groups.length, 2);
  const apollo = groups.find((g) => g.id === "prog-apollo")!;
  assert.equal(apollo.name, "Apollo Programme"); // admin-chosen name
  assert.equal(apollo.projectCount, 2);
  assert.equal(standaloneCount(projects, registry), 1); // only guid-x
});

test("programmeDetail returns members + name, or null when empty", () => {
  const projects = [proj({ id: "a", omniInstanceId: "guid-3" })];
  const detail = programmeDetail(projects, "prog-zephyr", registry)!;
  assert.equal(detail.name, "Zephyr");
  assert.equal(detail.projects.length, 1);
  assert.equal(programmeDetail(projects, "prog-apollo", registry), null); // no members present
});

test("with an empty registry, nothing groups (registry is the source of truth)", () => {
  const projects = [proj({ id: "a", omniInstanceId: "guid-1", programmeId: "prog-apollo" })];
  assert.equal(groupProgrammes(projects, {}).length, 0);
  assert.equal(standaloneCount(projects, {}), 1);
});
