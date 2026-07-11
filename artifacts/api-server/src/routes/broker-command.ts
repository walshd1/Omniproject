/*
 * Generic broker command passthrough (the command-palette edge).
 *
 * Route: POST /api/broker/command. Forwards an arbitrary action through the
 * neutral `brokerCommand()` seam helper — this route never imports a concrete
 * adapter, so the boundary holds with ZERO exceptions. See docs/BROKER.md.
 */
import { Router, type Request, type Response } from "express";
import { BrokerCommandBody } from "@workspace/api-zod";
import { contextFromReq, respondBrokerError, BrokerError, brokerCommand, brokerConfigured } from "../broker";
import { getSettings } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { getSession } from "./auth";
import { enforceCapability, CapabilityBlockedError, getCapability } from "../lib/capability-governance";

const router = Router();

async function handle(req: Request, res: Response): Promise<void> {
  // This edge can invoke arbitrary backend actions, including writes
  // (create/update/delete). The per-action REST routes gate writes behind
  // `contributor`; without the same gate here a read-only `viewer` session
  // could forward a `delete_issue` and bypass every write wall. So we require
  // `contributor` for the whole edge (the SPA does not use it for reads).
  if (!brokerConfigured()) {
    // No backend wired (demo mode, no admin-set broker URL): there is nothing to
    // forward to. Return the normalised "demo" error instead of attempting a live
    // n8n call that would surface as an opaque "backend unreachable".
    respondBrokerError(
      res,
      new BrokerError("unavailable", "No backend configured (demo mode): command passthrough requires a live broker"),
    );
    return;
  }

  const parse = BrokerCommandBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { action, source } = parse.data;

  // Vendor governance: when the active backend names a specific vendor, that vendor's
  // capability must be turned on (off by default). Denials are logged. When the source
  // is "all"/unknown we can't attribute to one vendor, so the gate is skipped.
  const vendorId = getSettings().backendSource?.trim();
  if (vendorId && getCapability(`vendor:${vendorId}`)) {
    try {
      const s = getSession(req);
      enforceCapability(`vendor:${vendorId}`, { actor: s ? { sub: s.sub, email: s.email } : null });
    } catch (err) {
      if (err instanceof CapabilityBlockedError) {
        respondBrokerError(res, new BrokerError("unavailable", `Vendor "${vendorId}" is turned off by the administrator`));
        return;
      }
      throw err;
    }
  }

  // Never trust client-supplied identity. Strip any userContext/origin from the
  // raw body; the server injects identity from the validated OIDC session.
  const rawPayload = (parse.data.payload ?? {}) as Record<string, unknown>;
  const { userContext: _ignoredUserContext, origin: _ignoredOrigin, ...payload } = rawPayload;

  try {
    const result = await brokerCommand(contextFromReq(req), action, payload, source ?? "unknown");
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err, action }, "broker command failed");
    respondBrokerError(res, err);
  }
}

router.post("/broker/command", requireRole("contributor"), handle);

export default router;
