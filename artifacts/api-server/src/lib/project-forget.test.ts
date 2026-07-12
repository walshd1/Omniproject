import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { forgetProjectGuid } from "./project-forget";
import { getSettings, updateSettings } from "./settings";

afterEach(() => updateSettings({ closedProjects: {}, programmeRegistry: {}, guidAliases: {} }));

test("forgetProjectGuid unlinks a GUID from every OmniProject list", () => {
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

  const s = getSettings();
  assert.equal("g1" in s.closedProjects, false);
  assert.deepEqual(s.programmeRegistry["prog-a"]!.instanceIds, ["g2"]); // g1 gone, g2 kept
  assert.deepEqual(s.programmeRegistry["prog-b"]!.instanceIds, ["g2"]); // untouched
  assert.deepEqual(s.guidAliases, {}); // both g1-referencing aliases dropped
  assert.ok("g2" in s.closedProjects, "g2 is untouched");
});

test("forgetProjectGuid is a no-op (all-empty result) for an unreferenced GUID", () => {
  updateSettings({ closedProjects: { keep: { disposition: "sor" } }, programmeRegistry: {}, guidAliases: {} });
  const result = forgetProjectGuid("never-seen");
  assert.deepEqual(result, { guid: "never-seen", removedFromClosed: false, removedFromProgrammes: [], removedAliases: 0 });
  assert.ok("keep" in getSettings().closedProjects);
});
