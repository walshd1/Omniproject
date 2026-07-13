/**
 * Setup config-I/O plane — moving durable gateway config in and out: env/compose/k8s export, the
 * config-directory summary + hot-reload/backup controls, the config bundle ZIP, the portable
 * snapshot/restore, and the dev-only debug bundle. Split out of the setup god router (Stage 3) as one
 * cohesive concern: every route here reads or writes the deployment's own config, all admin-gated,
 * nothing touching project data.
 *
 * Mounted by ./setup.ts under the same base, so every path stays `/setup/...` exactly as before.
 */
import { Router } from "express";
import { getSettings, updateSettings } from "../../lib/settings";
import { requireRole } from "../../lib/rbac";
import { requireStepUp } from "../../lib/step-up";
import { buildConfigExport, type ExportFormat } from "../../lib/config-export";
import { auditStatus, recordAudit, actorForAudit } from "../../lib/audit";
import { configDirSummary } from "../../lib/config-dir";
import { refreshConfigDir, configBackupInfo, clearConfigBackup } from "../../lib/config-refresh";
import { buildConfigBundle } from "../../lib/config-bundle";
import { buildSnapshot, applySnapshot } from "../../lib/config-snapshot";
import { captureVersion } from "../../lib/config-store";
import { isDevMode } from "../../lib/dev-mode";
import { buildDebugBundleZip } from "../../lib/debug-bundle";

const router = Router();

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
// (OMNI_CONFIG_DIR) loaded (vendor overlay counts, config applied, errors), plus the
// `.old` backup's age — the SPA nudges the admin to clear it out once `stale`.
router.get("/setup/config-dir", requireRole("admin"), (_req, res) => {
  res.json({ ...configDirSummary(), backup: configBackupInfo() });
});

// POST /api/setup/config-dir/refresh — admin + step-up: hot-reload the config directory
// NOW instead of waiting for a restart (the operator has already edited the files on
// disk). Backs the current directory up to `.old` first and auto-reverts to it if the
// new load reports any file error, so a bad hand-edit can never leave the gateway
// running on a half-applied broken config.
router.post("/setup/config-dir/refresh", requireRole("admin"), requireStepUp, (req, res) => {
  const result = refreshConfigDir();
  recordAudit({
    ts: new Date().toISOString(), category: "admin", action: "config-dir.refresh",
    actor: actorForAudit(req), write: true,
    result: result.ok ? "success" : "error",
    meta: { errors: result.summary.errors.length, warnings: result.summary.warnings.length, reverted: result.reverted, backedUp: result.backedUp },
  });
  // Always 200: the REQUEST succeeded (a refresh was attempted and completed one way or
  // another) regardless of whether the new config was accepted — `ok`/`reverted` on the
  // body carry that outcome, so the SPA can render "applied" / "reverted, here's why" /
  // "failed, no backup to revert to" without treating any of them as a transport error.
  res.json(result);
});

// POST /api/setup/config-dir/clear-backup — admin: delete the `.old` backup (the 30-day
// cleanup nudge's action). Not step-up gated — the backup carries no more privilege than
// the live config already does, and this is a routine housekeeping action, not a change
// to live behaviour.
router.post("/setup/config-dir/clear-backup", requireRole("admin"), (req, res) => {
  const cleared = clearConfigBackup();
  recordAudit({
    ts: new Date().toISOString(), category: "admin", action: "config-dir.clear-backup",
    actor: actorForAudit(req), write: true,
    result: cleared ? "success" : "error",
  });
  res.json({ cleared });
});

// GET /api/setup/config-bundle — admin "lock this config": download the current
// effective config as the exact folder-of-JSON the loader reads (read ≡ dump).
router.get("/setup/config-bundle", requireRole("admin"), (_req, res) => {
  const zip = buildConfigBundle();
  res.type("application/zip").set("Content-Disposition", 'attachment; filename="omniproject-config.zip"').send(zip);
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
