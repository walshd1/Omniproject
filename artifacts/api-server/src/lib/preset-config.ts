/**
 * SCOPE-OVERRIDABLE presets — the resolver behind the presets route. The shipped presets (backend-catalogue
 * `presetCatalogue`) are seeded as the system-scope `presets` config def (see system-defs), and an org (or a
 * lower scope) folds its own overrides on top via the shared `resolveConfig`: nearest scope wins, and the
 * `list` array merges BY ID — so an org can relabel/retarget a shipped preset (same id) or ADD a new bespoke
 * one (new id), exactly the copy-and-override every other catalogue gets. Presets are DATA in system JSON, not
 * code; this is where a customer's preset customisations resolve.
 */
import { presetCatalogue, presetReferenceErrors, type Preset } from "@workspace/backend-catalogue";
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";

/** The system-scope config def id holding the preset list (the base layer the scope resolver folds onto). */
export const PRESETS_CONFIG_ID = "presets";

/** The seeded `values` for the system `presets` config def — the shipped catalogue under a `list` key. */
export function presetConfigValues(): { list: Preset[] } {
  return { list: presetCatalogue() };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Coerce one folded entry into a well-formed Preset, or null when a required field is missing/mistyped. */
function coercePreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (!isStr(e["id"]) || !isStr(e["label"]) || !isStr(e["description"]) || !isStr(e["methodology"])) return null;
  const order = typeof e["order"] === "number" ? e["order"] : 0;
  return {
    id: e["id"], label: e["label"], description: e["description"], methodology: e["methodology"], order,
    ...(isStr(e["settingsPreset"]) ? { settingsPreset: e["settingsPreset"] } : {}),
    ...(isStr(e["referenceRuleset"]) ? { referenceRuleset: e["referenceRuleset"] } : {}),
    ...(isStr(e["projectTemplate"]) ? { projectTemplate: e["projectTemplate"] } : {}),
    ...(isStr(e["dashboardPreset"]) ? { dashboardPreset: e["dashboardPreset"] } : {}),
    ...(isStrArray(e["tags"]) ? { tags: e["tags"] } : {}),
  };
}

/**
 * The effective presets at the given scopes: shipped base (`presetCatalogue`) with system→org→programme→
 * project→user config-def layers folded on top (nearest wins, list merges by id). Every resolved preset is
 * re-validated — a dangling reference (a preset naming a methodology/ruleset/template/dashboard that doesn't
 * resolve) is DROPPED, so an org override can never half-wire a preset. Deduped by id, ordered.
 */
export function resolvePresets(scopes: ConfigScopes = {}): Preset[] {
  const base = presetConfigValues() as unknown as Record<string, unknown>;
  const layers = configDefLayers(PRESETS_CONFIG_ID, scopes);
  const folded = resolveScopedConfig<Record<string, unknown>>(base, layers);
  const list = Array.isArray(folded["list"]) ? folded["list"] : [];
  const out: Preset[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const p = coercePreset(raw);
    if (!p || seen.has(p.id)) continue;
    if (presetReferenceErrors(p).length) continue; // drop a preset whose references don't resolve
    seen.add(p.id);
    out.push(p);
  }
  return out.sort((a, b) => a.order - b.order);
}

/** One resolved preset by id (system + overrides), or undefined. */
export function resolvePreset(id: string, scopes: ConfigScopes = {}): Preset | undefined {
  return resolvePresets(scopes).find((p) => p.id === id);
}
