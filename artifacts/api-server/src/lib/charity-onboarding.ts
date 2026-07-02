import { getSettings, updateSettings, type Dashboard } from "./settings";
import { deploymentProfile, profilePosture, type ProfilePosture } from "./deployment-profile";
import { dashboardPresetCatalogue, widgetDef, type DashboardPreset } from "@workspace/backend-catalogue";
import { nomenclaturePresets, applyNomenclaturePreset } from "./nomenclature";
import { isEntitled } from "./license";

/**
 * "We're a charity" one-click onboarding preset — the small-org counterpart to picking a
 * deployment profile by hand. A charity ops lead shouldn't have to know that this means
 * `DEPLOYMENT_PROFILE=nonprofit`, which dashboard presets exist, or that nomenclature is a
 * separate licensed feature — one action does all three, reusing existing mechanisms only:
 *
 *   1. Selects the existing `nonprofit` deployment profile (relaxes TLS/no-IdP severity by
 *      choice — see deployment-profile.ts).
 *   2. Mints the `trustee-report` + `funder-report` dashboard presets (existing widgets only,
 *      see assets/dashboard-presets/) as fresh, saved dashboards — a charity's board pack and
 *      funder report, one click away, without wading through the widget catalogue.
 *   3. Best-effort adopts the active backend's nomenclature preset, IF one exists and the
 *      deployment is entitled to the (premium, currently free-to-run pre-community) `labels`
 *      feature — this degrades gracefully to a no-op when neither is true, since it is a
 *      convenience, not something this preset invents.
 *
 * Idempotent: re-running it won't duplicate dashboards already present (matched by preset name).
 */

const CHARITY_DASHBOARD_PRESET_IDS = ["trustee-report", "funder-report"] as const;

/** Turn a dashboard preset into a fresh, saveable Dashboard (mirrors the SPA's
 *  `dashboardFromPreset` — the server-side mint used when applying a preset on the operator's
 *  behalf, since this endpoint saves directly rather than round-tripping through the SPA). */
function mintDashboard(preset: DashboardPreset): Dashboard {
  return {
    id: crypto.randomUUID(),
    name: preset.name,
    widgets: preset.widgets.map((w) => {
      const span = w.span ?? widgetDef(w.type)?.defaultSpan ?? 1;
      const widget: Dashboard["widgets"][number] = { id: crypto.randomUUID(), type: w.type, span };
      if (w.title) widget.title = w.title;
      return widget;
    }),
  };
}

export interface CharityOnboardingResult {
  profile: string;
  posture: ProfilePosture;
  /** The dashboards minted by this run (empty if they were already present). */
  dashboardsAdded: { id: string; name: string }[];
  nomenclature: { applied: boolean; backendId: string | null; reason: string };
}

/** Apply the full "We're a charity" preset in one step. Idempotent and additive — never removes
 *  an existing dashboard or setting, only sets the profile and adds what's missing. */
export function applyCharityOnboarding(): CharityOnboardingResult {
  updateSettings({ deploymentProfile: "nonprofit" });

  const settings = getSettings();
  const existingNames = new Set((settings.dashboards ?? []).map((d) => d.name));
  const presets = dashboardPresetCatalogue().filter((p) => (CHARITY_DASHBOARD_PRESET_IDS as readonly string[]).includes(p.id));
  const minted = presets.filter((p) => !existingNames.has(p.name)).map(mintDashboard);
  if (minted.length > 0) {
    updateSettings({ dashboards: [...(settings.dashboards ?? []), ...minted] });
  }

  const backendId = settings.backendSource?.trim() || null;
  let nomenclature: CharityOnboardingResult["nomenclature"];
  if (!isEntitled("labels")) {
    nomenclature = { applied: false, backendId, reason: "not entitled to the labels feature" };
  } else if (backendId && nomenclaturePresets().some((p) => p.backendId === backendId)) {
    applyNomenclaturePreset(backendId);
    nomenclature = { applied: true, backendId, reason: `adopted the ${backendId} nomenclature preset` };
  } else {
    nomenclature = { applied: false, backendId, reason: backendId ? `no nomenclature preset for backend "${backendId}"` : "no backend selected yet" };
  }

  return {
    profile: deploymentProfile(),
    posture: profilePosture(),
    dashboardsAdded: minted.map((d) => ({ id: d.id, name: d.name })),
    nomenclature,
  };
}
