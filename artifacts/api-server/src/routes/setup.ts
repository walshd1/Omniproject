import { Router } from "express";
import { getSettings } from "../lib/settings";
import { isN8nConfigured } from "../lib/n8n";
import { isOidcConfigured } from "../lib/oidc";
import { resolveCapabilities } from "../lib/capabilities";
import { requireRole, roleForReq } from "../lib/rbac";
import { buildConfigExport, type ExportFormat } from "../lib/config-export";
import { backendCatalogue, getBackend } from "../lib/n8n-backends";
import { generateWorkflow } from "../lib/n8n-generator";

const router = Router();

/** Contract actions safe to probe live (never mutate a backend). */
const VERIFIABLE_ACTIONS = [
  "get_capabilities",
  "list_projects",
  "list_issues",
  "list_activity",
  "get_resource_capacity",
  "get_project_financials",
  "get_portfolio_health",
  "get_project_history",
  "get_baseline",
  "get_raid",
  "get_notifications",
] as const;

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
    realtime: { enabled: !!process.env["NOTIFY_INGEST_SECRET"]?.trim() },
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

// GET /api/setup/backends — catalogue for the workflow wizard.
router.get("/setup/backends", (_req, res) => {
  res.json(backendCatalogue());
});

// POST /api/setup/generate-workflow — emit an importable n8n workflow for the
// chosen backend. Stateless: returned for download, nothing stored. Admin only.
router.post("/setup/generate-workflow", requireRole("admin"), (req, res) => {
  const backendId = typeof req.body?.backendId === "string" ? req.body.backendId : "";
  const webhookPath = typeof req.body?.webhookPath === "string" ? req.body.webhookPath : undefined;
  const manifest = getBackend(backendId);
  if (!manifest) {
    res.status(404).json({ error: `Unknown backend: ${backendId}` });
    return;
  }
  const workflow = generateWorkflow(manifest, { webhookPath });
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-${manifest.id}.json"`)
    .send(JSON.stringify(workflow, null, 2));
});

// POST /api/setup/verify-workflow — probe the configured n8n with verify:true
// for each non-mutating action and report per-action conformance. Admin only.
// The { verify: true } flag lets a generated workflow short-circuit so nothing
// touches the backend; only read/declarative actions are probed regardless.
router.post("/setup/verify-workflow", requireRole("admin"), async (req, res) => {
  const url = (typeof req.body?.webhookUrl === "string" && req.body.webhookUrl.trim()) || getSettings().n8nWebhookUrl;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "No n8n webhook configured. Connect n8n first or pass webhookUrl." });
    return;
  }
  const sampleProjectId = typeof req.body?.projectId === "string" ? req.body.projectId : "sample";

  const results = await Promise.all(
    VERIFIABLE_ACTIONS.map(async (action) => {
      const started = Date.now();
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-OmniProject-Action": action,
            "X-OmniProject-Origin": "omniproject",
          },
          body: JSON.stringify({ action, payload: { projectId: sampleProjectId }, source: "verify", origin: "omniproject", verify: true }),
          signal: AbortSignal.timeout(8_000),
        });
        const ms = Date.now() - started;
        const json = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { verified?: boolean }; message?: string };
        const verifyAware = !!json?.data?.verified;
        const ok = r.ok && json?.success !== false;
        return { action, ok, status: r.status, ms, verifyAware, message: json?.message ?? null };
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        return { action, ok: false, status: 0, ms: Date.now() - started, verifyAware: false, message: isTimeout ? "timed out" : "unreachable" };
      }
    }),
  );

  const passed = results.filter((r) => r.ok).length;
  res.json({
    webhookUrl: url,
    summary: { passed, total: results.length, verifyAware: results.some((r) => r.verifyAware) },
    results,
    note: "Write actions (create/update/delete) are not probed to avoid mutating your backend. A generated workflow honours { verify: true } so even reads never hit the backend.",
  });
});

export default router;
