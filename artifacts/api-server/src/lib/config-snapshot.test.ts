import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, applySnapshot } from "./config-snapshot";
import { getSettings, updateSettings } from "./settings";

/**
 * Snapshot capture/restore for a user's bespoke artifact definitions. These are the customisations a
 * user authors (custom reports, report overrides, content pages) — they belong in the backup alongside
 * saved views, so "keep your bespoke config backed up" actually captures them. The shipped baseline defs
 * live in code, never in settings, so they are structurally absent from the snapshot.
 */
test("snapshot captures + restores bespoke reports, overrides and content pages", () => {
  updateSettings({
    customReports: [{ id: "r1", label: "By status", scope: "tasks", viz: "bar", groupBy: "status", metrics: [{ id: "m", field: "id", agg: "count" }] }],
    reportOverrides: [{ id: "evm", label: "Earned Value", hidden: false }],
    contentPages: [{ id: "p1", name: "Exec", componentIds: ["report:evm"] }],
  });

  const snap = buildSnapshot(getSettings());
  assert.equal(snap.settings.customReports.length, 1);
  assert.equal(snap.settings.customReports[0]!.id, "r1");
  assert.equal(snap.settings.reportOverrides.length, 1);
  assert.equal(snap.settings.contentPages[0]!.name, "Exec");

  // Wipe, then restore from the snapshot — the bespoke defs come back.
  updateSettings({ customReports: [], reportOverrides: [], contentPages: [] });
  assert.equal(getSettings().customReports.length, 0);

  const { patch, warnings } = applySnapshot(snap);
  updateSettings(patch);
  assert.equal(getSettings().customReports[0]!.id, "r1");
  assert.equal(getSettings().contentPages[0]!.componentIds[0], "report:evm");
  assert.equal(warnings.filter((w) => /customReports|reportOverrides|contentPages/.test(w)).length, 0);

  updateSettings({ customReports: [], reportOverrides: [], contentPages: [] });
});
