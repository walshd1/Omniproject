import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyCharityOnboarding } from "./charity-onboarding";
import { updateSettings, getSettings } from "./settings";
import { setRuntimeProfile } from "./deployment-profile";

/**
 * "We're a charity" one-click onboarding preset — selects the nonprofit deployment profile,
 * mints the trustee-report + funder-report dashboards, and best-effort adopts a nomenclature
 * preset. Additive + idempotent, so these tests reset the shared settings store afterwards.
 */
afterEach(() => {
  updateSettings({ deploymentProfile: "business", dashboards: [] });
  setRuntimeProfile(null);
});

test("selects the nonprofit deployment profile", () => {
  const result = applyCharityOnboarding();
  assert.equal(result.profile, "nonprofit");
  assert.match(result.posture.label, /charity/i);
});

test("mints the trustee-report + funder-report dashboards from the existing presets", () => {
  const result = applyCharityOnboarding();
  const names = result.dashboardsAdded.map((d) => d.name);
  assert.ok(names.includes("Trustee report"));
  assert.ok(names.includes("Funder report"));

  const saved = getSettings().dashboards;
  const trustee = saved.find((d) => d.name === "Trustee report");
  const funder = saved.find((d) => d.name === "Funder report");
  assert.ok(trustee && trustee.widgets.length > 0);
  assert.ok(funder && funder.widgets.length > 0);
  // Every placed widget got a fresh id (mint, not the preset's raw shape).
  for (const w of [...trustee!.widgets, ...funder!.widgets]) {
    assert.ok(typeof w.id === "string" && w.id.length > 0);
    assert.ok(typeof w.type === "string" && w.type.length > 0);
  }
});

test("is idempotent — running it twice doesn't duplicate the dashboards", () => {
  applyCharityOnboarding();
  const second = applyCharityOnboarding();
  assert.equal(second.dashboardsAdded.length, 0, "already-present dashboards are not re-minted");
  const names = getSettings().dashboards.map((d) => d.name);
  assert.equal(names.filter((n) => n === "Trustee report").length, 1);
  assert.equal(names.filter((n) => n === "Funder report").length, 1);
});

test("never removes a dashboard the operator already had", () => {
  updateSettings({ dashboards: [{ id: "existing", name: "My dashboard", widgets: [] }] });
  const result = applyCharityOnboarding();
  const names = getSettings().dashboards.map((d) => d.name);
  assert.ok(names.includes("My dashboard"));
  assert.ok(names.includes("Trustee report"));
  assert.equal(result.dashboardsAdded.length, 2);
});

test("nomenclature is best-effort and degrades gracefully when no preset matches the backend", () => {
  const result = applyCharityOnboarding();
  assert.equal(result.nomenclature.applied, false);
  assert.ok(result.nomenclature.reason.length > 0);
});
