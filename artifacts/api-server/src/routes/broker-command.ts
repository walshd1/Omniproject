/*
 * Generic broker command passthrough (the command-palette edge).
 *
 * Canonical route: POST /api/broker/command. The legacy POST /api/n8n-proxy is
 * kept as a deprecated alias for back-compat. This is the one place above the
 * seam permitted to import the n8n adapter directly (it IS the adapter's command
 * edge); see docs/BROKER.md → boundary invariants.
 */
import { Router, type Request, type Response } from "express";
import { BrokerCommandBody } from "@workspace/api-zod";
import { N8nBroker } from "../broker/n8n";
import { contextFromReq, respondBrokerError } from "../broker";

const router = Router();
const broker = new N8nBroker();

async function handle(req: Request, res: Response): Promise<void> {
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

router.post("/broker/command", handle); // canonical
router.post("/n8n-proxy", handle); // deprecated alias (v0.1 compatibility)

export default router;
