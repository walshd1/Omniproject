import type { Request, Response, NextFunction } from "express";
import { sharedKv, sharedStateMode } from "./shared-state";
import { safeParseJson } from "./safe-json";

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
 *
 * FLEET BEHAVIOUR (mirrors lib/ai-kill's break-glass pattern): the local flag is set synchronously
 * so the guard stays a zero-I/O hot path. An INTERACTIVE toggle also writes through to shared state
 * (`publishMaintenanceToShared`), and a periodic poll (`startMaintenanceFleetSync`) converges every
 * replica — so a freeze engaged on ANY replica takes effect across the fleet within the sync
 * interval, not just on the replica that served the request (previously it froze only 1/N).
 * Convergence is Redis-only: in in-process (single-replica) mode the durable local security-state
 * file remains authoritative, so restart-survival is unchanged. Boot-restore deliberately does NOT
 * publish — a replica adopts the fleet's current state rather than imposing its (possibly stale)
 * local file on it.
 */
export const MAINTENANCE_KEY = "break-glass:maintenance";

let engaged = false;
let reason = "";

/** Engage read-only lockdown (optionally with a human-readable reason shown to clients). LOCAL only —
 *  the route calls `publishMaintenanceToShared` after an interactive toggle to fan it out; boot-restore
 *  intentionally does not, so a rejoining replica adopts the fleet state instead of imposing its file. */
export function engageMaintenance(why = ""): void { engaged = true; reason = why; }
/** Release lockdown — normal read/write resumes. LOCAL only (see `engageMaintenance`). */
export function releaseMaintenance(): void { engaged = false; reason = ""; }
/** Is the gateway in read-only lockdown? */
export function maintenanceEngaged(): boolean { return engaged; }
/** The reason shown with a blocked write (empty when not set). */
export function maintenanceReason(): string { return reason; }

/** Fan THIS replica's current lockdown state out to shared state so the fleet converges. Call after an
 *  INTERACTIVE toggle only. Best-effort — the local flag is already set, so a shared-state blip never
 *  blocks the operator's action on the handling replica. */
export async function publishMaintenanceToShared(): Promise<void> {
  try {
    if (engaged) await sharedKv.set(MAINTENANCE_KEY, JSON.stringify({ reason }));
    else await sharedKv.del(MAINTENANCE_KEY);
  } catch { /* best-effort fan-out; local flag already set */ }
}

/** Converge this replica with the fleet's shared lockdown state (the fleet-sync tick; also directly
 *  testable). No-op in in-process mode — there is no fleet, and the durable local file is authoritative
 *  there, so a single-replica restart-survival freeze is never clobbered by an empty shared store. In
 *  Redis mode the shared value wins, so a freeze/release on ANY replica takes effect here. */
export async function refreshMaintenanceFromShared(): Promise<void> {
  if (sharedStateMode() !== "redis") return;
  try {
    const raw = await sharedKv.get(MAINTENANCE_KEY);
    if (raw === null) { engaged = false; reason = ""; return; }
    engaged = true;
    // Cross-replica value ⇒ untrusted: prototype-safe parse, and coerce reason to a string.
    try { const r = (safeParseJson(raw) as { reason?: unknown })?.reason; reason = typeof r === "string" ? r : ""; }
    catch { reason = ""; }
  } catch { /* keep the last known state on a shared-state blip — fail toward the current posture */ }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start periodic fleet convergence so a lockdown flipped on ANY replica takes effect here. Idempotent;
 *  the interval is unref'd so it never keeps the process alive. Returns a stop handle. */
export function startMaintenanceFleetSync(intervalMs = 3000): () => void {
  if (!timer) {
    timer = setInterval(() => { void refreshMaintenanceFromShared(); }, intervalMs);
    timer.unref?.();
  }
  return stopMaintenanceFleetSync;
}
/** Stop the periodic fleet-sync poll (idempotent) — used on shutdown / in tests. */
export function stopMaintenanceFleetSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

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

/** Test-only: reset to the default (released) and stop any fleet-sync timer. */
export function __resetMaintenance(): void { engaged = false; reason = ""; stopMaintenanceFleetSync(); }
