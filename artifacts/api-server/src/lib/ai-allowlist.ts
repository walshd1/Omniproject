import { configDefLayers, resolveFloorConfig, tightenAllowlist, writeOrgConfigCollection, type ConfigScopes } from "./scoped-config";
import { SettingsValidationError } from "./settings";

/**
 * AI SELECTION ALLOWLISTS — governance FLOORS (roadmap Phase C) over which AI providers / models / STT engines
 * may be SELECTED (`aiProvider` / `aiModel` / `sttProvider`). The org sets a ceiling and a lower scope
 * (programme/project) may only NARROW it further, never add something the org forbade. `null` = no restriction
 * (everything the deployment offers is selectable) — the default, so an ungoverned deployment is unchanged.
 *
 * Each lives in the composition model as a config def, resolved with the cross-scope FLOOR fold
 * (`resolveFloorConfig` + `tightenAllowlist`) rather than the default nearest-wins merge. The `"none"` selection
 * (AI/STT off) and the EMPTY model (provider default) are ALWAYS permitted — an allowlist governs which concrete
 * options are allowed, never whether the feature can be turned off / left at its default.
 */
export const AI_PROVIDER_ALLOWLIST_ID = "ai-provider-allowlist";
export const AI_MODEL_ALLOWLIST_ID = "ai-model-allowlist";
export const STT_PROVIDER_ALLOWLIST_ID = "stt-provider-allowlist";

/** Validate an allowlist value: `null` (unrestricted) or an array of id strings. `label` names it in errors. */
function sanitize(label: string, value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SettingsValidationError(`${label} must be null or an array of strings`);
  }
  return value as string[];
}

/** The floor-resolved allowed set for a config, or `null` (unrestricted). Folds the per-scope `{value}` layers
 *  base→leaf with the allowlist tighten step, so the org sets the ceiling and each lower scope can only narrow it. */
function resolveAllowlist(configId: string, scopes: ConfigScopes): string[] | null {
  const layers = configDefLayers(configId, scopes).map((v) => {
    const inner = (v as { value?: unknown }).value;
    return inner == null ? null : (inner as string[]);
  });
  return resolveFloorConfig<string[] | null>(null, layers, tightenAllowlist);
}

/** Whether `id` is within a resolved allowlist (or the allowlist is unrestricted). */
function withinAllowlist(allowed: string[] | null, id: string): boolean {
  return allowed == null || allowed.includes(id);
}

// ── AI provider ──────────────────────────────────────────────────────────────────────────────────────────────
export function sanitizeAiProviderAllowlist(value: unknown): string[] | null { return sanitize("aiProviderAllowlist", value); }
export function resolveAiProviderAllowlist(scopes: ConfigScopes = {}): string[] | null { return resolveAllowlist(AI_PROVIDER_ALLOWLIST_ID, scopes); }
/** Whether `providerId` may be SELECTED. `"none"` (AI off) is always allowed. */
export function aiProviderAllowed(providerId: string, scopes: ConfigScopes = {}): boolean {
  return providerId === "none" || withinAllowlist(resolveAiProviderAllowlist(scopes), providerId);
}
export function writeOrgAiProviderAllowlist(value: string[] | null): void { writeOrgConfigCollection(AI_PROVIDER_ALLOWLIST_ID, "AI provider allowlist", value); }

// ── AI model ─────────────────────────────────────────────────────────────────────────────────────────────────
export function sanitizeAiModelAllowlist(value: unknown): string[] | null { return sanitize("aiModelAllowlist", value); }
export function resolveAiModelAllowlist(scopes: ConfigScopes = {}): string[] | null { return resolveAllowlist(AI_MODEL_ALLOWLIST_ID, scopes); }
/** Whether `model` may be SELECTED. An empty/absent model (= use the provider default) is always allowed. */
export function aiModelAllowed(model: string | null | undefined, scopes: ConfigScopes = {}): boolean {
  const m = (model ?? "").trim();
  return m === "" || withinAllowlist(resolveAiModelAllowlist(scopes), m);
}
export function writeOrgAiModelAllowlist(value: string[] | null): void { writeOrgConfigCollection(AI_MODEL_ALLOWLIST_ID, "AI model allowlist", value); }

// ── STT provider ─────────────────────────────────────────────────────────────────────────────────────────────
export function sanitizeSttProviderAllowlist(value: unknown): string[] | null { return sanitize("sttProviderAllowlist", value); }
export function resolveSttProviderAllowlist(scopes: ConfigScopes = {}): string[] | null { return resolveAllowlist(STT_PROVIDER_ALLOWLIST_ID, scopes); }
/** Whether `sttProvider` may be SELECTED. `"none"` (STT off) is always allowed. */
export function sttProviderAllowed(providerId: string, scopes: ConfigScopes = {}): boolean {
  return providerId === "none" || withinAllowlist(resolveSttProviderAllowlist(scopes), providerId);
}
export function writeOrgSttProviderAllowlist(value: string[] | null): void { writeOrgConfigCollection(STT_PROVIDER_ALLOWLIST_ID, "STT provider allowlist", value); }
