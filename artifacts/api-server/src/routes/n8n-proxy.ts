import { Router } from "express";
import { N8nProxyBody } from "@workspace/api-zod";

const router = Router();

router.post("/n8n-proxy", async (req, res) => {
  const parse = N8nProxyBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { action, payload, source } = parse.data;

  const n8nWebhookUrl =
    process.env["N8N_WEBHOOK_URL"] || "http://localhost:5678/webhook/omniproject";

  const authHeader = req.headers["authorization"];

  try {
    const n8nRes = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
        "X-OmniProject-Source": source ?? "unknown",
        "X-OmniProject-Action": action,
      },
      body: JSON.stringify({ action, payload, source }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!n8nRes.ok) {
      req.log.warn(
        { status: n8nRes.status, action },
        "n8n webhook returned non-OK status",
      );
      res.status(502).json({ error: `n8n returned ${n8nRes.status}` });
      return;
    }

    const data = await n8nRes.json().catch(() => ({}));
    res.json({ success: true, data });
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    req.log.error({ err, action }, "n8n proxy request failed");
    res
      .status(502)
      .json({ error: isTimeout ? "n8n request timed out" : "n8n unreachable" });
  }
});

export default router;
