import type { RelaxPredicate } from "./security-settings";

/**
 * The config-def analogue of `security-settings.ts` (design §0 + §6a, roadmap Phase C). A config-def-backed
 * collection is EITHER a "choice" (applies immediately, Phase B) OR "security-relevant" (a change that REDUCES
 * the posture is held for a signed sign-off — the same governing invariant that guards `SettingsState`).
 *
 * A `SECURITY_CONFIGS` entry is keyed by the logical `configId` (the same id passed to `writeOrgConfigCollection`
 * / `readConfigCollection`) and is a {@link RelaxPredicate} returning TRUE when the RESOLVED value moves old→new
 * in a way that WEAKENS the posture. As with settings, where the direction is ambiguous the predicate is
 * fail-CLOSED (`changed`); over-gating is safe (a gate never blocks — it only asks for a signature).
 *
 * A config is guarded IFF it is registered here — exactly mirroring "a settings key is guarded iff it is in
 * `SECURITY_SETTINGS`". The registry starts empty and grows as each security-classified collection migrates off
 * settings onto a scope-layered config def (Phase C slices). `settings-collection-router` consults it: a config
 * in this map writes through `applyConfigCollectionGuarded` (sign-off on relax); anything else writes directly.
 */
export const SECURITY_CONFIGS: Record<string, RelaxPredicate> = {
  // Error telemetry — the admin opt-in for internal client-error reporting. Directional, mirroring its old
  // `SECURITY_SETTINGS` classification: turning it ON is the relaxation (held for a sign-off); turning it OFF
  // strengthens and applies immediately.
  "error-telemetry": (o, n) => n === true && o !== true,
  // Logging-sync egress — streaming the event log to an operator-owned destination. Directional (verbatim from
  // the old `SECURITY_SETTINGS` predicate): the relaxation is ending up ENABLED with a NEW destination (newly
  // turned on, or redirected while on); disabling strengthens and applies immediately.
  "logging-sync": (o, n) => {
    const on = (v: unknown): boolean => !!(v && typeof v === "object" && (v as { enabled?: unknown }).enabled === true);
    const dest = (v: unknown): unknown => (v && typeof v === "object" ? (v as { url?: unknown }).url : undefined);
    return on(n) && (!on(o) || dest(o) !== dest(n));
  },
};

/** TRUE when moving `configId` from `oldValue`→`newValue` relaxes the posture. FALSE for a choice config (not
 *  registered) or a strengthening/neutral change — i.e. "does this write need a signed sign-off?". Pure. */
export function relaxingConfig(configId: string, oldValue: unknown, newValue: unknown): boolean {
  const predicate = SECURITY_CONFIGS[configId];
  return predicate ? predicate(oldValue, newValue) : false;
}

/** Whether `configId` is a security-classified config def (its relaxation needs a sign-off). */
export function isSecurityConfig(configId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SECURITY_CONFIGS, configId);
}
