import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyCharityOnboarding } from "./charity-onboarding";
import { updateSettings, getSettings } from "./settings";
import { setRuntimeProfile } from "./deployment-profile";
import { nomenclaturePresets } from "./nomenclature";

/**
 * "We're a charity" one-click onboarding preset — selects the nonprofit deployment profile,
 * mints the trustee-report + funder-report dashboards, and best-effort adopts a nomenclature
 * preset. Additive + idempotent, so these tests reset the shared settings store afterwards.
 */
afterEach(() => {
  updateSettings({ deploymentProfile: "business", dashboards: [], backendSource: "" });
  setRuntimeProfile(null);
  delete process.env["PREMIUM_ENFORCEMENT"];
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

test("nomenclature: not entitled to labels → skipped with a clear reason", () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on"; // paywall labels (no licence configured)
  const result = applyCharityOnboarding();
  assert.equal(result.nomenclature.applied, false);
  assert.match(result.nomenclature.reason, /not entitled/);
});

test("nomenclature: entitled + a backend with a preset → the preset is adopted", () => {
  const presets = nomenclaturePresets();
  if (presets.length === 0) return; // no vendor ships a nomenclature preset in this build
  const backendId = presets[0]!.backendId;
  updateSettings({ backendSource: backendId }); // pre-community entitles `labels` by default
  const result = applyCharityOnboarding();
  assert.equal(result.nomenclature.applied, true);
  assert.equal(result.nomenclature.backendId, backendId);
  assert.match(result.nomenclature.reason, new RegExp(`adopted the ${backendId}`));
});

test("nomenclature: entitled but backend has no preset → reason names the backend", () => {
  updateSettings({ backendSource: "definitely-not-a-real-backend-xyz" });
  const result = applyCharityOnboarding();
  assert.equal(result.nomenclature.applied, false);
  assert.match(result.nomenclature.reason, /no nomenclature preset for backend/);
});
