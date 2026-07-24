import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Dashboards are minted as org `dashboard` DEFS now, so the encrypted def store must be configured first.
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "charity-"));
import { applyCharityOnboarding } from "./charity-onboarding";
import { updateSettings } from "./settings";
import { setRuntimeProfile } from "./deployment-profile";
import { nomenclaturePresets } from "./nomenclature";
import { listDefs, newStoredDef, putDef, DEF_ARTIFACT } from "./def-import";
import { replaceArtifacts } from "./artifact-store";
import { makeScopedId } from "./artifact-store";
import type { ActorContext } from "../broker/types";

/**
 * "We're a charity" one-click onboarding preset — selects the nonprofit deployment profile,
 * mints the trustee-report + funder-report dashboards as org DEFS, and best-effort adopts a
 * nomenclature preset. Additive + idempotent, so these tests reset the shared stores afterwards.
 */
const CTX: ActorContext = { sub: "admin", role: "admin" };
const NOW = "2026-01-01T00:00:00.000Z";

/** The org-authored dashboard defs' payloads (what charity onboarding mints into the def store). */
function orgDashboards(): { name: string; widgets: { id: string; type: string }[] }[] {
  return listDefs({ kind: "org" })
    .filter((r) => r.kind === "dashboard")
    .map((r) => r.payload as { name: string; widgets: { id: string; type: string }[] });
}

/** Seed a pre-existing dashboard def (an operator's own), so we can assert onboarding never removes it. */
function seedDashboard(name: string): void {
  const payload = { id: makeScopedId("org", "seed"), name, widgets: [] };
  putDef({ kind: "org" }, newStoredDef(makeScopedId("org", "seed"), { kind: "dashboard", name, payload, value: payload }, CTX, NOW));
}

afterEach(() => {
  replaceArtifacts(DEF_ARTIFACT, { kind: "org" }, []);
  updateSettings({ deploymentProfile: "business", backendSource: "" });
  setRuntimeProfile(null);
  delete process.env["PREMIUM_ENFORCEMENT"];
});

test("selects the nonprofit deployment profile", () => {
  const result = applyCharityOnboarding(CTX, NOW);
  assert.equal(result.profile, "nonprofit");
  assert.match(result.posture.label, /charity/i);
});

test("mints the trustee-report + funder-report dashboards from the existing presets", () => {
  const result = applyCharityOnboarding(CTX, NOW);
  const names = result.dashboardsAdded.map((d) => d.name);
  assert.ok(names.includes("Trustee report"));
  assert.ok(names.includes("Funder report"));

  const saved = orgDashboards();
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
  applyCharityOnboarding(CTX, NOW);
  const second = applyCharityOnboarding(CTX, NOW);
  assert.equal(second.dashboardsAdded.length, 0, "already-present dashboards are not re-minted");
  const names = orgDashboards().map((d) => d.name);
  assert.equal(names.filter((n) => n === "Trustee report").length, 1);
  assert.equal(names.filter((n) => n === "Funder report").length, 1);
});

test("never removes a dashboard the operator already had", () => {
  seedDashboard("My dashboard");
  const result = applyCharityOnboarding(CTX, NOW);
  const names = orgDashboards().map((d) => d.name);
  assert.ok(names.includes("My dashboard"));
  assert.ok(names.includes("Trustee report"));
  assert.equal(result.dashboardsAdded.length, 2);
});

test("nomenclature is best-effort and degrades gracefully when no preset matches the backend", () => {
  const result = applyCharityOnboarding(CTX, NOW);
  assert.equal(result.nomenclature.applied, false);
  assert.ok(result.nomenclature.reason.length > 0);
});

test("nomenclature: not entitled to labels → skipped with a clear reason", () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on"; // paywall labels (no licence configured)
  const result = applyCharityOnboarding(CTX, NOW);
  assert.equal(result.nomenclature.applied, false);
  assert.match(result.nomenclature.reason, /not entitled/);
});

test("nomenclature: entitled + a backend with a preset → the preset is adopted", () => {
  const presets = nomenclaturePresets();
  if (presets.length === 0) return; // no vendor ships a nomenclature preset in this build
  const backendId = presets[0]!.backendId;
  updateSettings({ backendSource: backendId }); // pre-community entitles `labels` by default
  const result = applyCharityOnboarding(CTX, NOW);
  assert.equal(result.nomenclature.applied, true);
  assert.equal(result.nomenclature.backendId, backendId);
  assert.match(result.nomenclature.reason, new RegExp(`adopted the ${backendId}`));
});

test("nomenclature: entitled but backend has no preset → reason names the backend", () => {
  updateSettings({ backendSource: "definitely-not-a-real-backend-xyz" });
  const result = applyCharityOnboarding(CTX, NOW);
  assert.equal(result.nomenclature.applied, false);
  assert.match(result.nomenclature.reason, /no nomenclature preset for backend/);
});
