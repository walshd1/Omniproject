import { Router, type Response } from "express";
import { getSettings, updateSettings } from "../lib/settings";
import { isLiveBroker } from "../broker";
import { isOidcConfigured } from "../lib/oidc";
import { resolveCapabilities } from "../lib/capabilities";
import { requireRole, roleForReq } from "../lib/rbac";
import { buildConfigExport, type ExportFormat } from "../lib/config-export";
import { backendCatalogue, getBackend, isEnterpriseBackend, generateWorkflow, brokerCatalogue, outputCatalogue } from "@workspace/backend-catalogue";
import { busMode } from "../lib/notify-bus";
import { brokerLogBusMode } from "../lib/broker-log-bus";
import { rateLimitMode } from "../lib/rate-limit";
import { licenseSummary, isEntitled, resolveLicense } from "../lib/license";
import { auditStatus } from "../lib/audit";
import { DEV_PERSIST_ENABLED } from "../lib/dev-persist";
import { getDemoState } from "../lib/data";
import { buildZip } from "../lib/zip";
import { buildSnapshot, applySnapshot } from "../lib/config-snapshot";
import { VERIFIABLE_ACTIONS } from "../broker/verifiable-actions";
import {
  storeView,
  captureVersion,
  createEnvironment,
  activateEnvironment,
  markKnownGood,
  rollbackTo,
  rollbackToLastKnownGood,
  promote,
} from "../lib/config-store";

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
    configured: isLiveBroker() || !!settings.brokerUrl,
    role: roleForReq(req),
    broker: {
      configured: isLiveBroker() || !!settings.brokerUrl,
      urlSet: !!settings.brokerUrl,
    },
    auth: { mode: isOidcConfigured ? "oidc" : "demo" },
    ai: { provider: settings.aiProvider },
    realtime: { enabled: !!process.env["NOTIFY_INGEST_SECRET"]?.trim(), bus: busMode() },
    // Horizontal-scale fan-out: "redis" = shared across replicas, "in-process" =
    // per-replica. Lets an operator verify multi-replica wiring at a glance.
    scale: { notifyBus: busMode(), brokerLogBus: brokerLogBusMode(), rateLimit: rateLimitMode() },
    audit: auditStatus(),
    dev: { statefulDemo: DEV_PERSIST_ENABLED },
    licensing: licenseSummary(),
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
      brokerUrl: s.brokerUrl,
      backendSource: s.backendSource,
      aiProvider: s.aiProvider,
      aiModel: s.aiModel,
      oidcIssuerUrl: s.oidcIssuerUrl,
      auditLevel: auditStatus().level,
    },
    format,
  );
  res.type("text/plain").send(text);
});

// GET /api/setup/backends — catalogue for the workflow wizard.
router.get("/setup/backends", (_req, res) => {
  res.json(backendCatalogue());
});

// The other two integration planes (same shape): which brokers can serve the
// data hop, and which outward interfaces expose data/events.
router.get("/setup/brokers", (_req, res) => {
  res.json(brokerCatalogue());
});
router.get("/setup/outputs", (_req, res) => {
  res.json(outputCatalogue());
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
  // Enterprise backend workflows (SAP, Primavera, Dynamics 365, …) are premium.
  if (isEnterpriseBackend(backendId) && !isEntitled("enterprise_workflows")) {
    res.status(402).json({
      error: `Generating the ${manifest.label} workflow is a licensed enterprise integration. Add a valid LICENSE_KEY with the "enterprise_workflows" feature.`,
      feature: "enterprise_workflows",
      backend: backendId,
      license: resolveLicense(),
    });
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
  const url = (typeof req.body?.webhookUrl === "string" && req.body.webhookUrl.trim()) || getSettings().brokerUrl;
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

// GET /api/setup/snapshot — download a portable JSON backup of gateway config.
router.get("/setup/snapshot", requireRole("admin"), (_req, res) => {
  const snapshot = buildSnapshot(getSettings());
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-snapshot.json"`)
    .send(JSON.stringify(snapshot, null, 2));
});

// POST /api/setup/restore — restore config from a snapshot (e.g. after a bad
// port/setup). Validates the snapshot, applies known settings, reports warnings.
router.post("/setup/restore", requireRole("admin"), (req, res) => {
  try {
    const { patch, warnings } = applySnapshot(req.body);
    const settings = updateSettings(patch);
    captureVersion("restored from snapshot");
    res.json({ restored: true, warnings, settings });
  } catch (err) {
    res.status(400).json({ restored: false, error: err instanceof Error ? err.message : "Invalid snapshot" });
  }
});

// ── Environments & versioned rollback ─────────────────────────────────────────

function handle(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "error" });
  }
}

// GET /api/setup/environments — environments, active env, version history.
router.get("/setup/environments", requireRole("admin"), (_req, res) => {
  res.json(storeView());
});

// POST /api/setup/environments { name } — create a sandbox (clone of active).
router.post("/setup/environments", requireRole("admin"), (req, res) => {
  handle(res, () => createEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/environments/activate { name } — switch the active environment.
router.post("/setup/environments/activate", requireRole("admin"), (req, res) => {
  handle(res, () => activateEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/promote { from, to } — copy one env's config onto another.
router.post("/setup/promote", requireRole("admin"), (req, res) => {
  handle(res, () => promote(String(req.body?.from ?? ""), String(req.body?.to ?? "")));
});

// POST /api/setup/versions/:id/known-good — pin a version as known-good.
router.post("/setup/versions/:id/known-good", requireRole("admin"), (req, res) => {
  handle(res, () => markKnownGood(String(req.params["id"])));
});

// POST /api/setup/rollback { versionId? , toKnownGood? } — fast rollback.
router.post("/setup/rollback", requireRole("admin"), (req, res) => {
  try {
    const result = req.body?.toKnownGood
      ? rollbackToLastKnownGood()
      : rollbackTo(String(req.body?.versionId ?? ""));
    res.json({ rolledBack: true, appliedVersion: result.applied.id, warnings: result.warnings, store: storeView() });
  } catch (err) {
    res.status(400).json({ rolledBack: false, error: err instanceof Error ? err.message : "error" });
  }
});

// GET /api/setup/debug-bundle — a ZIP of config + demo data state for
// reproducible bug reports / sharing to GitHub. Available ONLY in stateful dev
// mode (refused in production), admin-only. This is a debugging aid, not a prod
// feature — production is stateless and has no data state to bundle.
router.get("/setup/debug-bundle", requireRole("admin"), (_req, res) => {
  if (!DEV_PERSIST_ENABLED) {
    res.status(409).json({
      error: "Debug bundle is available only in stateful developer mode (DEV_PERSIST_FILE, non-production). Production is stateless.",
    });
    return;
  }
  const now = new Date().toISOString();
  const config = buildSnapshot(getSettings());
  const state = getDemoState();
  const readme =
    "# OmniProject debug bundle\n\n" +
    `Generated ${now}.\n\n` +
    "For **reproducible bug reports** only — share on a GitHub issue. Contains:\n" +
    "- `config.json` — gateway configuration snapshot (no secrets; those live in env).\n" +
    "- `demo-state.json` — the in-memory demo dataset (projects/issues/RAID).\n\n" +
    "To reproduce locally: run a **non-production** build with `DEV_PERSIST_FILE` pointed\n" +
    "at a copy of `demo-state.json`, and apply `config.json` via Setup → Restore.\n" +
    "Stateful mode is a debugging aid; **never enable it in production** (it is ignored there).\n";

  const zip = buildZip([
    { name: "README.md", data: Buffer.from(readme, "utf8") },
    { name: "config.json", data: Buffer.from(JSON.stringify(config, null, 2), "utf8") },
    { name: "demo-state.json", data: Buffer.from(JSON.stringify(state, null, 2), "utf8") },
  ]);
  res
    .type("application/zip")
    .set("Content-Disposition", `attachment; filename="omniproject-debug-bundle-${now.slice(0, 10)}.zip"`)
    .send(zip);
});

export default router;
