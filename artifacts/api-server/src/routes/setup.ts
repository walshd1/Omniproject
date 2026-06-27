/**
 * Setup-wizard + operations endpoints — backend/plane catalogues, workflow
 * generation + verification, config export/snapshot/restore, the sandbox→promote→
 * rollback environment controls, and the debug bundle. Mostly admin-gated; this is
 * the operator-facing surface for wiring + lifecycle, not project data.
 */
import { Router, type Response } from "express";
import { getSettings, updateSettings } from "../lib/settings";
import { resolveCapabilities, resolveSupport } from "../lib/capabilities";
import { connectedBrokerKinds } from "../broker/registry";
import { requireRole, hasRole } from "../lib/rbac";
import { buildConfigExport, type ExportFormat } from "../lib/config-export";
import { backendCatalogue, getBackend, isEnterpriseBackend, generateWorkflow, brokerCatalogue, outputCatalogue, notificationCatalogue, notificationRouteCatalogue, notificationKindCatalogue, methodologyCatalogue, methodologyPack, allMethodologyTags, reportCatalogue, screenCatalogue, reportsForMethodology, screensForMethodology, planeCatalogue, availableReports, availableScreens, VIEWS, viewsForMethodology, dedupeEntities, matchCandidates, normaliseKey } from "@workspace/backend-catalogue";
import { isEntitled, resolveLicense } from "../lib/license";
import { auditStatus } from "../lib/audit";
import { isDevMode } from "../lib/dev-mode";
import { buildDebugBundleZip } from "../lib/debug-bundle";
import { buildSnapshot, applySnapshot } from "../lib/config-snapshot";
import { configDirSummary } from "../lib/config-dir";
import { buildConfigBundle } from "../lib/config-bundle";
import { buildSetupStatus } from "../lib/setup-status";
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
// Assembled from a registry of status sections (see lib/setup-status.ts).
router.get("/setup/status", async (req, res) => {
  res.json(await buildSetupStatus(req));
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

// GET /api/setup/config-dir — admin: what the deployment config directory
// (OMNI_CONFIG_DIR) loaded at boot (vendor overlay counts, config applied, errors).
router.get("/setup/config-dir", requireRole("admin"), (_req, res) => {
  res.json(configDirSummary());
});

// GET /api/setup/config-bundle — admin "lock this config": download the current
// effective config as the exact folder-of-JSON the loader reads (read ≡ dump).
router.get("/setup/config-bundle", requireRole("admin"), (_req, res) => {
  const zip = buildConfigBundle();
  res.type("application/zip").set("Content-Disposition", 'attachment; filename="omniproject-config.zip"').send(zip);
});

// GET /api/setup/backends — catalogue for the workflow wizard. Admin-only backends
// (raw SQL / Mongo) are hidden from non-admins so they aren't offered a technical
// integration they can't configure (wiring one is admin-gated at generate-workflow
// / settings regardless — this just keeps the wizard honest per role).
router.get("/setup/backends", (req, res) => {
  const isAdmin = hasRole(req, "admin"); // the technical authority
  res.json(backendCatalogue().filter((b) => isAdmin || !b.adminOnly));
});

// The other two integration planes (same shape): which brokers can serve the
// data hop, and which outward interfaces expose data/events.
// Full broker catalogue, or — with ?connected=1 — only the broker KIND(S) actually
// wired to this deployment (the active hop ∪ BROKER_KINDS), the set the capability
// resolver unions over.
router.get("/setup/brokers", (req, res) => {
  if (req.query["connected"] !== "1") { res.json(brokerCatalogue()); return; }
  const kinds = new Set(connectedBrokerKinds());
  res.json(brokerCatalogue().filter((b) => kinds.has(b.id)));
});
router.get("/setup/outputs", (_req, res) => {
  res.json(outputCatalogue());
});
router.get("/setup/notifications", (_req, res) => {
  res.json(notificationCatalogue());
});
// The notification ROUTING rules (JSON-defined) — which event kinds dispatch to
// which delivery channels. The generic dispatch decision; delivery is below the seam.
router.get("/setup/notification-routes", (_req, res) => {
  res.json(notificationRouteCatalogue());
});
// The canonical notification KINDS + their severity — the vocabulary routes match on.
router.get("/setup/notification-kinds", (_req, res) => {
  res.json(notificationKindCatalogue());
});
router.get("/setup/methodologies", (_req, res) => {
  res.json(methodologyCatalogue());
});
// A methodology PACK — the methodology's definition + every asset carrying its tag
// (views, notification routes, ruleset), as one importable JSON bundle. Admin only:
// it's the portable look-and-feel an operator drops into another deployment's config.
router.get("/setup/methodology-pack/:id", requireRole("admin"), (req, res) => {
  const pack = methodologyPack(String(req.params["id"]));
  if (!pack) { res.status(404).json({ error: "Unknown methodology" }); return; }
  res.setHeader("Content-Disposition", `attachment; filename="methodology-${pack.methodology.id}.json"`);
  res.json(pack);
});
// The board views (JSON-defined) + the cross-plane DERIVED methodology tag list.
// With ?methodology=<tag>, only the views that methodology activates (+ neutral ones).
router.get("/setup/views", (req, res) => {
  const m = req.query["methodology"];
  const views = typeof m === "string" && m ? viewsForMethodology(m) : VIEWS;
  res.json({ views, methodologies: allMethodologyTags() });
});
// The DERIVED methodology PRESET — every asset a methodology activates, across
// planes (views, reports, screens), so a "click kanban" preset surfaces them all.
router.get("/setup/methodology-preset/:id", (req, res) => {
  const id = String(req.params["id"]);
  res.json({ methodology: id, views: viewsForMethodology(id), reports: reportsForMethodology(id), screens: screensForMethodology(id) });
});
// Full catalogue (what OmniProject CAN do), or — with ?available=1 — only the
// entries the CONNECTED backend(s) can actually feed. The hard rule: if none of
// the connected backends support a report/screen, ?available=1 omits it. (`caps`
// is the resolved set — already the union across every connected backend.)
router.get("/setup/reports", async (req, res) => {
  if (req.query["available"] !== "1") { res.json(reportCatalogue()); return; }
  const support = await resolveSupport(req).catch(() => null);
  res.json(support ? availableReports(support) : reportCatalogue());
});
router.get("/setup/screens", async (req, res) => {
  if (req.query["available"] !== "1") { res.json(screenCatalogue()); return; }
  const support = await resolveSupport(req).catch(() => null);
  res.json(support ? availableScreens(support) : screenCatalogue());
});
// The plane meta-registry — all seven planes + their dev docs.
router.get("/setup/planes", (_req, res) => {
  res.json(planeCatalogue());
});

// Entity-resolution PREVIEW — illustrates reconciling the same real-world entity
// across backends. Runs the stateless helpers over an ILLUSTRATIVE sample (no real
// customer data; nothing is stored). A real deployment feeds records from its
// connected backends and persists any CONFIRMED mapping as JSON in its config dir —
// the truth stays in the backends, never at rest here.
router.get("/setup/entity-resolution/preview", (_req, res) => {
  interface SampleContact { source: string; name: string; email?: string; externalId?: string }
  const sample: SampleContact[] = [
    { source: "jira", name: "Alice Smith", email: "alice@acme.io", externalId: "u-1" },
    { source: "salesforce", name: "Alice Smith", email: "ALICE@acme.io", externalId: "c-9" },
    { source: "erp", name: "alice  smith", email: "alice@acme.io" },
    { source: "jira", name: "Bob Jones", email: "bob@acme.io", externalId: "u-2" },
  ];
  res.json({
    note: "Illustrative sample — no customer data is read or stored. Confirmed mappings would live in the config dir as JSON.",
    deduped: dedupeEntities(sample, (c) => normaliseKey(c.email)),
    candidates: matchCandidates(sample, [
      { name: "email", fn: (c) => normaliseKey(c.email) },
      { name: "name", fn: (c) => normaliseKey(c.name) },
    ]),
  });
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

// GET /api/setup/debug-bundle — a reproducible ZIP of config + loaded vendors +
// demo data + captured broker/notify/export traffic, for sharing on a GitHub issue
// or reloading on another instance to replicate a problem. Available ONLY in dev
// mode (refused in production — dev mode is hard-gated off there), admin-only.
router.get("/setup/debug-bundle", requireRole("admin"), (_req, res) => {
  if (!isDevMode()) {
    res.status(409).json({
      error: "Debug bundle is available only in developer mode (a non-production build with OMNI_DEV_MODE / DEV_PERSIST_FILE / BROKER_TRACE / BROKER_CAPTURE). Production is stateless and never bundles.",
    });
    return;
  }
  const now = new Date().toISOString();
  const zip = buildDebugBundleZip(now);
  res
    .type("application/zip")
    .set("Content-Disposition", `attachment; filename="omniproject-debug-bundle-${now.slice(0, 10)}.zip"`)
    .send(zip);
});

export default router;
