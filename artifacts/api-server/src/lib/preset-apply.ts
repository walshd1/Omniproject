import {
  presetReferenceErrors, getReferenceRuleset, resolveProjectTemplate,
  type Preset, type ProjectTemplate, type ReferenceRuleset,
} from "@workspace/backend-catalogue";

/**
 * PRESET APPLY — the plan for landing an org on a quick-load preset in one action. A preset (see the
 * backend-catalogue `preset-catalogue`) is a BUNDLE of references; applying it composes several existing,
 * privileged operations. This module is PURE: it resolves the preset + its referenced pieces into a plan the
 * route then executes (apply the reference ruleset, instantiate the starter project) and reports as
 * follow-ups for the SPA to finish (curate the methodology composition, mint the persona dashboard, load the
 * posture blueprint) — the steps that need catalogue knowledge the SPA holds, or settings the operator should
 * opt into. Keeping the resolution pure means it's unit-tested and the route stays a thin I/O shell.
 */

/** A rejected preset apply (→ 404 for unknown, 400 for a dangling reference). */
export class PresetError extends Error {
  constructor(message: string, readonly status: 404 | 400) { super(message); this.name = "PresetError"; }
}

/** The resolved plan for applying a preset — the side-effecting pieces the route runs, plus the follow-ups. */
export interface PresetApplyPlan {
  preset: Preset;
  /** The reference ruleset to apply, or null when the preset declares none. */
  rulesetBundle: ReferenceRuleset | null;
  /** The starter project template to instantiate (shipped ⊕ org overrides), or null when none. */
  template: ProjectTemplate | null;
  /** What the SPA should finish after the server-side steps: curate to this methodology, and (optional) load
   *  the posture blueprint + mint the persona dashboard. These need catalogue knowledge the SPA holds (the
   *  full composition item set) or are operator opt-ins, so they aren't executed here. */
  followUps: {
    methodologyComposition: string;
    settingsPreset?: string;
    dashboardPreset?: string;
  };
}

/**
 * Resolve an (already scope-resolved) preset into an apply plan. The caller resolves the preset from the
 * system+org config first (see preset-config `resolvePreset`), so an org's copy-and-override wins; a missing
 * preset is `undefined` → 404. `orgTemplates` are the org's template overrides (so an org customisation of the
 * starter template wins over the shipped one, exactly like the templates route). Throws {@link PresetError}
 * when the preset is unknown (404) or any reference dangles (400 — a stored/imported preset is untrusted).
 */
export function planPresetApply(preset: Preset | undefined, orgTemplates: readonly ProjectTemplate[]): PresetApplyPlan {
  if (!preset) throw new PresetError("Preset not found", 404);

  const refErrors = presetReferenceErrors(preset);
  if (refErrors.length) throw new PresetError(`preset "${preset.id}" has dangling references: ${refErrors.join("; ")}`, 400);

  const rulesetBundle = preset.referenceRuleset ? getReferenceRuleset(preset.referenceRuleset) ?? null : null;
  const template = preset.projectTemplate ? resolveProjectTemplate(preset.projectTemplate, orgTemplates) ?? null : null;

  return {
    preset,
    rulesetBundle,
    template,
    followUps: {
      methodologyComposition: preset.methodology,
      ...(preset.settingsPreset ? { settingsPreset: preset.settingsPreset } : {}),
      ...(preset.dashboardPreset ? { dashboardPreset: preset.dashboardPreset } : {}),
    },
  };
}
