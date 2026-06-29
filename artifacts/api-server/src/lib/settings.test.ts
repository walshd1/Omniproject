import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, SettingsValidationError } from "./settings";

afterEach(() => {
  updateSettings({ savedViews: [], hiddenFields: [], disabledFeatures: [] }); // reset shared store
});

test("savedViews: accepts well-formed views and persists them", () => {
  const views = [
    { id: "v1", name: "My grid", scope: "grid", columns: ["title", "status"], sort: { field: "status", dir: "asc" as const } },
    { id: "v2", name: "Due soon" },
  ];
  const s = updateSettings({ savedViews: views });
  assert.equal(s.savedViews.length, 2);
  assert.equal(getSettings().savedViews[0]!.name, "My grid");
});

test("savedViews: rejects a non-array and a view missing id/name", () => {
  assert.throws(() => updateSettings({ savedViews: "nope" }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ name: "no id" }] }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ id: "x" }] }), SettingsValidationError);
});

test("hiddenFields: rejects a non-string-array", () => {
  assert.throws(() => updateSettings({ hiddenFields: [1, 2] as unknown as string[] }), SettingsValidationError);
  assert.deepEqual(updateSettings({ hiddenFields: ["dueDate"] }).hiddenFields, ["dueDate"]);
});
