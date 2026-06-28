import type { Request, Response, NextFunction } from "express";

/**
 * Maintenance lockdown (break-glass read-only mode).
 *
 * One flag that puts the WHOLE gateway into read-only: while engaged, every mutating request
 * (POST/PUT/PATCH/DELETE) is refused with 503, so a deployment can be frozen during an
 * incident, a migration, or a risky change window without taking it offline. Reads keep
 * working, so users still see their data.
 *
 * Carefully exempted so an admin can always get back out and orchestration stays healthy:
 *   - auth (login/logout/step-up) — you must be able to sign in to lift it;
 *   - the lockdown toggle itself — the way back to normal;
 *   - health/readiness probes.
 *
 * Admin-set + step-up gated; persisted via the durable security state so a freeze survives a
 * restart (you don't want a restart to silently un-freeze a deployment mid-incident).
 */
let engaged = false;
let reason = "";

/** Engage read-only lockdown (optionally with a human-readable reason shown to clients). */
export function engageMaintenance(why = ""): void { engaged = true; reason = why; }
/** Release lockdown — normal read/write resumes. */
export function releaseMaintenance(): void { engaged = false; reason = ""; }
/** Is the gateway in read-only lockdown? */
export function maintenanceEngaged(): boolean { return engaged; }
/** The reason shown with a blocked write (empty when not set). */
export function maintenanceReason(): string { return reason; }

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Path suffixes that must keep working even under lockdown (so you can sign in + lift it).
const EXEMPT = [
  "/auth/login", "/auth/logout", "/auth/callback", "/auth/step-up",
  "/admin/maintenance", // the toggle itself
  "/healthz", "/readyz",
];

/** Should this request be allowed through despite a write + lockdown? */
export function isMaintenanceExempt(path: string): boolean {
  return EXEMPT.some((suffix) => path.endsWith(suffix));
}

/** Middleware: under lockdown, refuse mutating requests (except exempt paths) with 503. */
export function maintenanceGuard(req: Request, res: Response, next: NextFunction): void {
  if (!engaged || !WRITE_METHODS.has(req.method) || isMaintenanceExempt(req.path)) { next(); return; }
  res.status(503).json({ error: reason || "The system is in read-only maintenance mode. Changes are temporarily disabled." });
}

/** Test-only: reset to the default (released). */
export function __resetMaintenance(): void { engaged = false; reason = ""; }
