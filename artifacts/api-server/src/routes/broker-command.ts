/*
 * Generic broker command passthrough (the command-palette edge).
 *
 * Route: POST /api/broker/command. This is the one place above the seam
 * permitted to import the n8n adapter directly (it IS the adapter's command
 * edge); see docs/BROKER.md → boundary invariants.
 */
import { Router, type Request, type Response } from "express";
import { BrokerCommandBody } from "@workspace/api-zod";
import { N8nBroker } from "../broker/n8n";
import { contextFromReq, respondBrokerError, isLiveBroker, BrokerError } from "../broker";
import { getSettings } from "../lib/settings";
import { requireRole } from "../lib/rbac";

const router = Router();
const broker = new N8nBroker();

/**
 * Is there a broker endpoint to forward a command to? True when one is configured
 * at boot (`BROKER_URL` ⇒ `isLiveBroker()`) OR set at runtime by an admin via
 * settings. The N8nBroker this edge uses resolves its webhook from
 * `getSettings().brokerUrl` first (it takes precedence over the env), so an
 * admin-configured URL is reachable without a restart — this gate just has to
 * agree with that precedence instead of looking only at the boot-time env.
 */
function brokerConfigured(): boolean {
  return isLiveBroker() || !!getSettings().brokerUrl?.trim();
}

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

  // Never trust client-supplied identity. Strip any userContext/origin from the
  // raw body; the server injects identity from the validated OIDC session.
  const rawPayload = (parse.data.payload ?? {}) as Record<string, unknown>;
  const { userContext: _ignoredUserContext, origin: _ignoredOrigin, ...payload } = rawPayload;

  try {
    const result = await broker.commandWithSource(contextFromReq(req), action, payload, source ?? "unknown");
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err, action }, "broker command failed");
    respondBrokerError(res, err);
  }
}

router.post("/broker/command", requireRole("contributor"), handle);

export default router;
