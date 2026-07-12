import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { forgetProjectGuid, collectProjectReferences } from "./project-forget";
import { getSettings, updateSettings } from "./settings";

afterEach(() => updateSettings({ closedProjects: {}, programmeRegistry: {}, guidAliases: {}, retiredGuids: [] }));

test("forgetProjectGuid unlinks a GUID from every OmniProject list AND retires it", () => {
  updateSettings({
    closedProjects: { "g1": { disposition: "archive" }, "g2": { disposition: "sor" } },
    programmeRegistry: { "prog-a": { name: "Alpha", instanceIds: ["g1", "g2"] }, "prog-b": { name: "Beta", instanceIds: ["g2"] } },
    guidAliases: { "old": "g1", "g1": "shouldnotexist-but-tests-both-sides" },
  });

  const result = forgetProjectGuid(" g1 ");
  assert.equal(result.guid, "g1");
  assert.equal(result.removedFromClosed, true);
  assert.deepEqual(result.removedFromProgrammes, ["prog-a"]);
  assert.equal(result.removedAliases, 2); // "old"→g1 and g1→…
  assert.equal(result.retired, true);

  const s = getSettings();
  assert.equal("g1" in s.closedProjects, false);
  assert.deepEqual(s.programmeRegistry["prog-a"]!.instanceIds, ["g2"]); // g1 gone, g2 kept
  assert.deepEqual(s.programmeRegistry["prog-b"]!.instanceIds, ["g2"]); // untouched
  assert.deepEqual(s.guidAliases, {}); // both g1-referencing aliases dropped
  assert.ok("g2" in s.closedProjects, "g2 is untouched");
  assert.ok(s.retiredGuids.includes("g1"), "g1 is tombstoned — can't silently reactivate");
});

test("forgetProjectGuid still retires an unreferenced GUID (delete = retire)", () => {
  updateSettings({ closedProjects: { keep: { disposition: "sor" } }, programmeRegistry: {}, guidAliases: {}, retiredGuids: [] });
  const result = forgetProjectGuid("never-seen");
  assert.deepEqual(result, { guid: "never-seen", removedFromClosed: false, removedFromProgrammes: [], removedAliases: 0, retired: true });
  assert.ok(getSettings().retiredGuids.includes("never-seen"));
  assert.ok("keep" in getSettings().closedProjects);
});

test("CLOSING a project (a closedProjects entry) retires its GUID — sticky, like deleting", () => {
  updateSettings({ closedProjects: { "gc": { disposition: "sor" } }, retiredGuids: [] });
  assert.ok(getSettings().retiredGuids.includes("gc"), "closing retires the GUID");
  // Removing the closed entry keeps it retired — reactivation needs a re-guid, not just un-closing.
  updateSettings({ closedProjects: {} });
  assert.ok(getSettings().retiredGuids.includes("gc"), "retirement is sticky");
});

test("collectProjectReferences gathers everything OmniProject holds (for export before delete)", () => {
  updateSettings({
    closedProjects: { "g1": { disposition: "archive", note: "moved" } },
    programmeRegistry: { "prog-a": { name: "Alpha", instanceIds: ["g1"] } },
    guidAliases: { "old": "g1", "g1": "successor" },
    retiredGuids: [],
  });
  const refs = collectProjectReferences("g1");
  assert.deepEqual(refs, {
    guid: "g1",
    closed: { disposition: "archive", note: "moved" },
    programmes: ["prog-a"],
    aliasedFrom: ["old"],
    aliasTo: "successor",
    retired: true, // a closed project is retired (the cross-rule), so it can't silently reactivate
  });
});
