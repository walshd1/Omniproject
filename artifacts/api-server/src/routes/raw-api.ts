import { Router, type Request, type Response } from "express";
import { contextFromReq, respondBrokerError, BrokerError, brokerCommand, brokerConfigured } from "../broker";
import { requireRole, roleForReq } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";
import { envFlag } from "../lib/env";

/**
 * ⚠️⚠️⚠️ RAW BROKER PASSTHROUGH — THE ESCAPE HATCH OF LAST RESORT ⚠️⚠️⚠️
 *
 * POST /api/admin/raw forwards an ARBITRARY action + payload straight to the
 * configured broker, BYPASSING the typed contract, capability gating and the
 * business ruleset. It exists only for the case where the supported, typed routes
 * genuinely cannot express what you need against a one-off backend. Prefer ANY
 * typed route, the generic /api/broker/command edge, or a proper backend mapping
 * first — reach for this only when nothing else works, and expect no safety net.
 *
 * What it does NOT relax (the hard floor is intact):
 *  - ADMIN ONLY (the technical authority) — requireRole("admin").
 *  - OFF BY DEFAULT — does nothing unless RAW_API_ENABLED is explicitly set; an
 *    un-opted-in deployment 404/503s, so the surface doesn't even exist.
 *  - Still rides the BROKER SEAM — it calls the already-configured broker (the
 *    admin-set, SSRF-guarded brokerUrl); the caller cannot name a URL, so this is
 *    NOT an SSRF primitive.
 *  - Still forwards the USER'S OWN bearer — the backend authorises the call as
 *    them, and every call is AUDITED (`raw_api`) with the action.
 *
 * What it DOES bypass (the "raw"/"last resort" part, by design):
 *  - the zod request contract (any action string + arbitrary payload),
 *  - capability gating (it won't check the backend claims to support the action),
 *  - the business ruleset (no require-field / freeze / no-delete checks).
 */
const router = Router();

const WARNING =
  "⚠️ RAW passthrough: bypasses the typed contract, capability gating and business ruleset. Admin-only, audited, last resort. Verify the action + payload against your backend.";

function rawEnabled(): boolean {
  return envFlag("RAW_API_ENABLED");
}

async function handle(req: Request, res: Response): Promise<void> {
  if (!rawEnabled()) {
    // The hatch is bolted shut unless an operator opted in. 503 (not 404) so the
    // intent is discoverable to an admin without advertising it when off.
    res.status(503).json({ error: "Raw API is disabled. Set RAW_API_ENABLED to enable the last-resort passthrough (here be dragons).", warning: WARNING });
    return;
  }
  if (!brokerConfigured()) {
    respondBrokerError(res, new BrokerError("unavailable", "No backend configured (demo mode): the raw passthrough requires a live broker."));
    return;
  }

  const body = (req.body ?? {}) as { action?: unknown; payload?: unknown };
  if (typeof body.action !== "string" || !body.action.trim()) {
    res.status(400).json({ error: "Body must be { action: string, payload?: object }", warning: WARNING });
    return;
  }
  if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
    res.status(400).json({ error: "payload, if present, must be a JSON object", warning: WARNING });
    return;
  }
  const action = body.action.trim();

  // Never trust client-supplied identity — strip any userContext/origin; the
  // server injects identity from the validated session (as /broker/command does).
  const raw = (body.payload ?? {}) as Record<string, unknown>;
  const { userContext: _u, origin: _o, ...payload } = raw;

  recordAudit({
    ts: new Date().toISOString(),
    category: "broker",
    action: `raw_api:${action}`,
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : { role: roleForReq(req) },
    write: true, // treat as a write — it can mutate; this keeps it in the writes audit level
    result: "success",
    status: 200,
  });

  res.setHeader("X-OmniProject-Raw-Warning", "bypasses contract+capability+ruleset; admin-only last resort");
  try {
    const data = await brokerCommand(contextFromReq(req), action, payload, "raw-api");
    res.json({ warning: WARNING, action, data });
  } catch (err) {
    req.log.error({ err, action }, "raw_api command failed");
    respondBrokerError(res, err);
  }
}

router.post("/admin/raw", requireRole("admin"), requireStepUp, handle);

export default router;
