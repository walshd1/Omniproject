import { PRESETS_DATA } from "./presets.generated";
import { getMethodology } from "./methodology-catalogue";
import { getReferenceRuleset } from "./methodology-rulesets";
import { getProjectTemplate } from "./template-catalogue";
import { dashboardPreset } from "./dashboard-preset-catalogue";

/**
 * PRESET catalogue — the QUICK-LOAD presets that configure an org for a way of working in ONE action. A preset
 * is a first-class BUNDLE: it doesn't hold content itself, it REFERENCES the pieces that already exist — a
 * methodology to curate the org to, a reference ruleset to apply, a starter project template to instantiate, a
 * persona dashboard to mint, and (server-side) a posture blueprint. This is the binding entity the product's
 * "many customers, different settings, quick-load presets" aim needs: authored as JSON under assets/presets/,
 * so a new preset is data, not code.
 *
 * The catalogue is deliberately thin — the APPLY orchestration (which writes the org's methodology composition,
 * applies the ruleset, and instantiates the starter project) lives in the api-server, because it composes
 * privileged, side-effecting operations over the broker + scoped stores. Here we only DEFINE + VALIDATE presets.
 */

/** A quick-load preset: a named bundle of references to the pieces that configure an org for a way of working. */
export interface Preset {
  /** Stable kebab id (also the asset filename). */
  id: string;
  label: string;
  description: string;
  /** The methodology the preset curates the org to — must resolve in the methodology catalogue. */
  methodology: string;
  /** Optional posture blueprint (settings-preset archetype). Validated by the SERVER at apply time (the
   *  blueprints live in the api-server, not this catalogue), so it's an opaque id here. */
  settingsPreset?: string;
  /** Optional reference-ruleset methodology id to apply — must resolve in the reference-ruleset catalogue. */
  referenceRuleset?: string;
  /** Optional project-template id to instantiate as a starter project — must resolve in the template catalogue. */
  projectTemplate?: string;
  /** Optional dashboard-preset id to mint for the operator — must resolve in the dashboard-preset catalogue. */
  dashboardPreset?: string;
  /** Cross-cutting tags for filtering/grouping. */
  tags?: string[];
  /** Display order. */
  order: number;
}

/** Every shipped preset, ordered. */
export const PRESETS: Preset[] = [...PRESETS_DATA].sort((a, b) => a.order - b.order);

/** One preset by id. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** All presets (a defensive copy). */
export function presetCatalogue(): Preset[] {
  return PRESETS.map((p) => ({ ...p }));
}

/**
 * Validate a preset's REFERENCES resolve against the catalogues this package owns (methodology, reference
 * ruleset, project template, dashboard preset). Returns every dangling reference (empty ⇒ the preset is
 * internally consistent). The `settingsPreset` is NOT checked here — it lives in the api-server and is
 * validated at apply time. A drift guard (preset-catalogue.test) runs this over every shipped preset, so a
 * preset can never reference a piece that doesn't exist.
 */
export function presetReferenceErrors(preset: Preset): string[] {
  const errors: string[] = [];
  if (!getMethodology(preset.methodology)) errors.push(`methodology "${preset.methodology}" does not resolve`);
  if (preset.referenceRuleset && !getReferenceRuleset(preset.referenceRuleset)) errors.push(`referenceRuleset "${preset.referenceRuleset}" does not resolve`);
  if (preset.projectTemplate && !getProjectTemplate(preset.projectTemplate)) errors.push(`projectTemplate "${preset.projectTemplate}" does not resolve`);
  if (preset.dashboardPreset && !dashboardPreset(preset.dashboardPreset)) errors.push(`dashboardPreset "${preset.dashboardPreset}" does not resolve`);
  return errors;
}

/** Whether a preset's references all resolve. */
export function isPresetConsistent(preset: Preset): boolean {
  return presetReferenceErrors(preset).length === 0;
}
