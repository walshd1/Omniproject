import { isDevMode } from "./dev-mode";

/**
 * Dev-mode entitlement overrides — force individual paid features on or off to test
 * the licensed vs unlicensed UX without minting a real licence.
 *
 * DEV ONLY: `applyDevEntitlementOverrides` is a no-op unless dev mode is active, so a
 * forgotten override can never alter entitlements in production (where dev mode is
 * gated off). Overrides are in-memory and per-process (ephemeral): they vanish on
 * restart and never persist. Every change is made through the admin, dev-gated
 * endpoint and recorded in the audit log.
 */

// feature id → forced state (true = granted, false = revoked). Absent = untouched.
const overrides = new Map<string, boolean>();

/** The current overrides as a plain object (feature → forced state). */
export function getDevEntitlementOverrides(): Record<string, boolean> {
  return Object.fromEntries(overrides);
}

/** Force a feature on/off, or pass null to clear that feature's override. */
export function setDevEntitlementOverride(feature: string, enabled: boolean | null): void {
  if (enabled === null) overrides.delete(feature);
  else overrides.set(feature, enabled);
}

/** Clear every override (e.g. on "reset" or in tests). */
export function clearDevEntitlementOverrides(): void {
  overrides.clear();
}

/**
 * Apply the dev overrides to a base feature list (dev mode only). `all` is the full
 * catalogue, so the result stays a stable subset of valid features. Returns the
 * same array reference when nothing changed.
 */
export function applyDevEntitlementOverrides<T extends string>(features: readonly T[], all: readonly T[]): T[] {
  if (!isDevMode() || overrides.size === 0) return features as T[];
  const set = new Set<T>(features);
  for (const [f, on] of overrides) {
    if (!all.includes(f as T)) continue;
    if (on) set.add(f as T);
    else set.delete(f as T);
  }
  return all.filter((f) => set.has(f));
}
