import { validatePatch, SCOPE_VARIABLE_SETTINGS, type SettingsState } from "./settings";
import { readScopedConfigValue, writeScopedConfigCollection, type ConfigWriteScope } from "./scoped-config";

/**
 * SCOPED SETTINGS OVERLAY — lets a programme/project override a SMALL, SAFE allow-list of settings for itself
 * (see SCOPE_VARIABLE_SETTINGS), governed by the delegation policy. Unlike the ruleset (restrict-only, so
 * tighten-only), settings are plain presentation VALUES, so the fold is ordinary OVERRIDE — the nearest scope
 * wins (org < programme < project). Only allow-listed keys are ever stored or applied; a non-allow-listed key
 * is dropped, so a scope can never touch org-global security/egress/deployment settings.
 */

export const SETTINGS_OVERRIDE_ID = "settings-override";

/** A scope's stored settings override — a partial map restricted to the scope-variable allow-list. */
export type SettingsOverride = Partial<Pick<SettingsState, (typeof SCOPE_VARIABLE_SETTINGS)[number]>>;

const isVariable = (k: string): k is (typeof SCOPE_VARIABLE_SETTINGS)[number] =>
  (SCOPE_VARIABLE_SETTINGS as readonly string[]).includes(k);

/** Keep only allow-listed keys from an arbitrary partial (defence in depth on read + write). */
function pickVariable(src: Record<string, unknown> | undefined): SettingsOverride {
  const out: Record<string, unknown> = {};
  if (src) for (const [k, v] of Object.entries(src)) if (isVariable(k) && v !== undefined) out[k] = v;
  return out as SettingsOverride;
}

/**
 * Resolve the EFFECTIVE settings for a request scope: the org base, with allow-listed keys overridden by the
 * programme override then the project override (nearest wins). Non-allow-listed keys are untouched — always the
 * org value. With no overrides this returns the base unchanged.
 */
export function resolveScopedSettings(
  base: SettingsState,
  scopes: { programmeId?: string | null | undefined; projectId?: string | null | undefined },
): SettingsState {
  const out = { ...base };
  const apply = (scope: ConfigWriteScope): void => {
    const override = pickVariable(readScopedConfigValue<Record<string, unknown>>(SETTINGS_OVERRIDE_ID, scope));
    Object.assign(out, override);
  };
  if (scopes.programmeId) apply({ kind: "programme", programmeId: scopes.programmeId });
  if (scopes.projectId) apply({ kind: "project", projectId: scopes.projectId });
  return out;
}

/** The stored override for one scope (for an admin UI), or an empty object. */
export function getSettingsOverride(scope: ConfigWriteScope): SettingsOverride {
  return pickVariable(readScopedConfigValue<Record<string, unknown>>(SETTINGS_OVERRIDE_ID, scope));
}

/**
 * Persist a scope's settings override (already delegation-gated by the caller). The patch is validated through
 * the SAME field-descriptor validation as org settings (so an invalid value is rejected) and then narrowed to
 * the allow-list — a non-scope-variable key can never be stored, even if it passed value validation.
 * Returns `{ override, rejected }`: the stored allow-listed subset and any keys refused as non-scope-variable.
 */
export function setSettingsOverride(scope: ConfigWriteScope, patch: Record<string, unknown>): { override: SettingsOverride; rejected: string[] } {
  const rejected = Object.keys(patch).filter((k) => !isVariable(k));
  const variableOnly = pickVariable(patch);
  // Validate values via the settings validator, then keep only the allow-listed keys it normalised.
  const normalised = validatePatch(variableOnly as Record<string, unknown>);
  const override = pickVariable(normalised);
  writeScopedConfigCollection(SETTINGS_OVERRIDE_ID, "Settings override", override, scope);
  return { override, rejected };
}
