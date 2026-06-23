import { Router } from "express";
import { getSettings } from "../lib/settings";
import { isN8nConfigured } from "../lib/n8n";
import { isOidcConfigured } from "../lib/oidc";
import { resolveCapabilities } from "../lib/capabilities";
import { requireRole, roleForReq } from "../lib/rbac";
import { buildConfigExport, type ExportFormat } from "../lib/config-export";

const router = Router();

/**
 * Setup / Connection Center endpoints. These are gateway control-plane (like
 * /auth), so the SPA calls them directly rather than through the generated data
 * client. Nothing here is persisted — the wizard reflects current settings and
 * emits durable config for the operator to keep in their environment.
 */

// GET /api/setup/status — what's wired, for the first-run wizard. Read-only.
router.get("/setup/status", async (req, res) => {
  const settings = getSettings();
  const capabilities = await resolveCapabilities(req).catch(() => null);
  res.json({
    configured: isN8nConfigured || !!settings.n8nWebhookUrl,
    role: roleForReq(req),
    n8n: {
      configured: isN8nConfigured || !!settings.n8nWebhookUrl,
      webhookUrlSet: !!settings.n8nWebhookUrl,
    },
    auth: { mode: isOidcConfigured ? "oidc" : "demo" },
    ai: { provider: settings.aiProvider },
    capabilities,
  });
});

// POST /api/setup/test-n8n — non-destructive reachability + capability probe of
// a candidate webhook URL (does NOT change settings). Admin only.
router.post("/setup/test-n8n", requireRole("admin"), async (req, res) => {
  const url = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ reachable: false, error: "Provide an absolute http(s) webhook URL" });
    return;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniProject-Action": "get_capabilities",
        "X-OmniProject-Source": "capability_probe",
        "X-OmniProject-Origin": "omniproject",
      },
      body: JSON.stringify({ action: "get_capabilities", payload: {}, source: "capability_probe", origin: "omniproject" }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!r.ok) {
      res.json({ reachable: true, ok: false, status: r.status, error: `Webhook responded ${r.status}` });
      return;
    }

    const json = (await r.json().catch(() => ({}))) as { data?: Record<string, boolean>; success?: boolean };
    const capabilities = json && typeof json === "object" && json.data && typeof json.data === "object" ? json.data : null;
    res.json({
      reachable: true,
      ok: true,
      status: r.status,
      implementsCapabilities: !!capabilities,
      capabilities,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    res.json({ reachable: false, error: isTimeout ? "Connection timed out" : "Could not reach the webhook URL" });
  }
});

// GET /api/setup/export?format=env|compose|k8s — durable config from current
// settings, so the operator can persist it in their environment. Admin only.
router.get("/setup/export", requireRole("admin"), (req, res) => {
  const fmt = String(req.query["format"] ?? "env");
  const format: ExportFormat = fmt === "compose" || fmt === "k8s" ? fmt : "env";
  const s = getSettings();
  const text = buildConfigExport(
    {
      n8nWebhookUrl: s.n8nWebhookUrl,
      backendSource: s.backendSource,
      aiProvider: s.aiProvider,
      aiModel: s.aiModel,
      oidcIssuerUrl: s.oidcIssuerUrl,
    },
    format,
  );
  res.type("text/plain").send(text);
});

export default router;
