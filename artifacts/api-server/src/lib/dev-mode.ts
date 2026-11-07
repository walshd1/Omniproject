import { getMessyConfig } from "./messy-data";
import { devModeActive, devPersistArmed, traceArmed, captureArmed } from "./dev-mode-guard";

/**
 * Dev mode — the single source of truth for "is this a developer/debug instance?".
 *
 * Dev mode is the umbrella the debug tooling (broker trace, capture/replay, the
 * debug bundle, stateful persistence) lives under, and it is what the UI
 * watermarks. It is HARD-GATED to non-production: `isDevMode()` is false whenever
 * NODE_ENV=production, so a released deployment can never present as a dev
 * instance or expose the dev surfaces, regardless of flags.
 *
 * It is active on a non-prod build when EITHER the explicit master switch
 * `OMNI_DEV_MODE=1` is set (what the dev docker-compose sets) OR any debug surface
 * is armed (stateful persistence, broker trace, or capture). The status it reports
 * tells an operator — and the on-screen watermark — exactly which surfaces are hot.
 */

/**
 * Is this a developer/debug instance? Always false in production.
 *
 * Delegates to {@link devModeActive} (lib/dev-mode-guard) over `process.env` so the
 * runtime surfaces gated on `isDevMode()` and the boot interlock (`runDevModeGuard`)
 * share ONE definition and can never drift. Production is decided fail-safe by
 * {@link isProductionEnv} — a mis-cased / unknown NODE_ENV reads as production.
 */
export function isDevMode(): boolean {
  return devModeActive(process.env);
}

export interface DevModeStatus {
  devMode: boolean;
  /** The raw environment label (so the watermark can show "development" vs "test"). */
  env: string;
  /** Which debug surfaces are currently armed. */
  surfaces: {
    persist: boolean;
    trace: boolean;
    capture: boolean;
    /** Synthetic messy-data injection into the read model (dev only). */
    messy: boolean;
  };
}

/** A small, public-safe projection — no paths, no secrets, just which surfaces are on. */
export function devModeStatus(): DevModeStatus {
  // Every surface flag is gated on `active` (not merely non-prod), so the watermark can
  // never advertise a surface as hot when dev mode itself is off — e.g. OMNI_MESSY_DATA is
  // not a dev-mode trigger, so `messy` must stay false unless a real trigger armed dev mode.
  // Each trigger reads the SAME live predicate the gate itself uses (dev-mode-guard), so the
  // status can never disagree with the gate.
  const active = isDevMode();
  return {
    devMode: active,
    env: process.env["NODE_ENV"] ?? "development",
    surfaces: {
      persist: active && devPersistArmed(process.env),
      trace: active && traceArmed(process.env),
      capture: active && captureArmed(process.env),
      messy: active && getMessyConfig().on,
    },
  };
}
