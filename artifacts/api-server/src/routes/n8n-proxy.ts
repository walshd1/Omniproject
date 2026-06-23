import { Router } from "express";
import { N8nProxyBody } from "@workspace/api-zod";
import { callN8n, authHeaderFromReq, userContextFromReq, N8nError } from "../lib/n8n";

const router = Router();

// Generic passthrough for arbitrary user actions (e.g. from the command
// palette). Project/issue data uses the typed routes, which also flow through
// the same n8n broker.
router.post("/n8n-proxy", async (req, res) => {
  const parse = N8nProxyBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { action, payload, source } = parse.data;

  try {
    const result = await callN8n(action, payload as Record<string, unknown>, {
      authHeader: authHeaderFromReq(req),
      source: source ?? "unknown",
      userContext: userContextFromReq(req),
    });
    res.json(result);
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    req.log.error({ err, action }, "n8n proxy request failed");
    const status = err instanceof N8nError ? err.status : 502;
    res
      .status(status)
      .json({ error: isTimeout ? "n8n request timed out" : err instanceof N8nError ? err.message : "n8n unreachable" });
  }
});

export default router;
