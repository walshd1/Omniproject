/*
 * Frozen public surface: the /n8n-proxy route + its N8nActionInput contract
 * shipped in v0.1 and is the n8n adapter's external command edge. It is the one
 * place above the seam that names n8n by design (see docs/BROKER.md → boundary
 * invariants). The generic command itself goes straight to the n8n adapter.
 */
import { Router } from "express";
import { N8nProxyBody } from "@workspace/api-zod";
import { N8nBroker } from "../broker/n8n";
import { contextFromReq, respondBrokerError } from "../broker";

const router = Router();
const broker = new N8nBroker();

// Generic passthrough for arbitrary user actions (e.g. from the command
// palette). Project/issue data uses the typed routes, which flow through the
// same broker seam.
router.post("/n8n-proxy", async (req, res) => {
  const parse = N8nProxyBody.safeParse(req.body);
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
    req.log.error({ err, action }, "proxy command failed");
    respondBrokerError(res, err);
  }
});

export default router;
