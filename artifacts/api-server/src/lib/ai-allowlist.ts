import { configDefLayers, resolveFloorConfig, tightenAllowlist, writeOrgConfigCollection, type ConfigScopes } from "./scoped-config";
import { SettingsValidationError } from "./settings";

/**
 * AI PROVIDER ALLOWLIST — a governance FLOOR (roadmap Phase C): the org restricts which AI providers may be
 * selected (`aiProvider`), and a lower scope (programme/project) may only NARROW that set further, never add a
 * provider the org forbade. `null` = no restriction (every provider the deployment offers is selectable) — the
 * default, so an ungoverned deployment is unchanged.
 *
 * It lives in the composition model as the `ai-provider-allowlist` config def, resolved with the cross-scope
 * FLOOR fold (`resolveFloorConfig` + `tightenAllowlist`) rather than the default nearest-wins merge — so the org
 * def sets the ceiling and each lower scope's def can only intersect it. `"none"` (AI off) is ALWAYS selectable:
 * an allowlist governs which providers are permitted, never whether AI can be turned off.
 */
export const AI_PROVIDER_ALLOWLIST_ID = "ai-provider-allowlist";

/** Validate an allowlist value: `null` (unrestricted) or an array of provider-id strings. */
export function sanitizeAiProviderAllowlist(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SettingsValidationError("aiProviderAllowlist must be null or an array of provider-id strings");
  }
  return value as string[];
}

/** The floor-resolved allowed provider set for a scope, or `null` when unrestricted (allow all). */
export function resolveAiProviderAllowlist(scopes: ConfigScopes = {}): string[] | null {
  const layers = configDefLayers(AI_PROVIDER_ALLOWLIST_ID, scopes).map((v) => {
    const inner = (v as { value?: unknown }).value;
    return inner == null ? null : (inner as string[]);
  });
  return resolveFloorConfig<string[] | null>(null, layers, tightenAllowlist);
}

/** Whether `providerId` may be SELECTED at the given scope. `"none"` (AI off) is always allowed; otherwise the
 *  provider must be within the floor-resolved allowlist (or the allowlist must be unrestricted). */
export function aiProviderAllowed(providerId: string, scopes: ConfigScopes = {}): boolean {
  if (providerId === "none") return true;
  const allowed = resolveAiProviderAllowlist(scopes);
  return allowed == null || allowed.includes(providerId);
}

/** Persist the ORG allowlist (the ceiling). Lower scopes narrow it via their own imported `ai-provider-allowlist`
 *  config defs, folded by `resolveAiProviderAllowlist`. */
export function writeOrgAiProviderAllowlist(value: string[] | null): void {
  writeOrgConfigCollection(AI_PROVIDER_ALLOWLIST_ID, "AI provider allowlist", value);
}
