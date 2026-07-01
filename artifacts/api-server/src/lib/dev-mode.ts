import { DEV_PERSIST_ENABLED } from "./dev-persist";
import { getMessyConfig } from "./messy-data";

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

function notProd(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

function traceArmed(): boolean {
  return process.env["BROKER_TRACE"] === "1";
}

function captureArmed(): boolean {
  return !!process.env["BROKER_CAPTURE"]?.trim();
}

/** Is this a developer/debug instance? Always false in production. */
export function isDevMode(): boolean {
  if (!notProd()) return false;
  return process.env["OMNI_DEV_MODE"] === "1" || DEV_PERSIST_ENABLED || traceArmed() || captureArmed();
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
  const prod = !notProd();
  return {
    devMode: isDevMode(),
    env: process.env["NODE_ENV"] ?? "development",
    surfaces: {
      persist: !prod && DEV_PERSIST_ENABLED,
      trace: !prod && traceArmed(),
      capture: !prod && captureArmed(),
      messy: !prod && getMessyConfig().on,
    },
  };
}
