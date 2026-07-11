import { Router } from "express";
import { getSettings } from "../lib/settings";
import { recordAudit, actorForAudit } from "../lib/audit";

/**
 * Client-error telemetry sink — an ADMIN-GATED, INTERNAL-only report channel.
 *
 * The SPA's ErrorBoundary posts an uncaught render error here (message + component stack +
 * the page it happened on — never user or project data). Nothing leaves the deployment: the
 * report is written to the gateway's own audit log, the same internal sink as every other
 * admin-observable event. It is a no-op unless an admin has turned on `errorTelemetry`
 * (Settings → Diagnostics), preserving the app's default no-telemetry posture.
 */
const router = Router();

/** Coerce to a bounded, single-string field: drop non-strings, collapse ALL control chars
 *  (CR/LF/NUL included) to spaces so a crafted stack can't inject into log processors, then
 *  truncate. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]+", "g");
function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").trim().slice(0, max);
}

router.post("/client-errors", (req, res) => {
  // Gate: silently accept-and-drop when the admin hasn't opted in, so a client that reports
  // out of turn (e.g. a stale tab after the setting was turned off) is a harmless no-op.
  if (!getSettings().errorTelemetry) {
    res.json({ recorded: false });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = clip(body["message"], 500);
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const page = clip(body["page"], 200);
  const componentStack = clip(body["componentStack"], 4000);

  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "client.error",
    actor: actorForAudit(req),
    ip: req.ip,
    result: "error",
    // write:true so the report is captured at the default AUDIT_LEVEL ("writes") — the record IS
    // the deliverable; it does not mutate any resource.
    write: true,
    meta: { message, ...(page ? { page } : {}), ...(componentStack ? { componentStack } : {}) },
  });
  res.json({ recorded: true });
});

export default router;
