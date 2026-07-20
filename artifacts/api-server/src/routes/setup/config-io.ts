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
import { auditStatus, recordRequestAudit } from "../../lib/audit";
import { configDirSummary } from "../../lib/config-dir";
import { refreshConfigDir, configBackupInfo, clearConfigBackup } from "../../lib/config-refresh";
import { buildConfigBundle } from "../../lib/config-bundle";
import { buildSnapshot, applySnapshot } from "../../lib/config-snapshot";
import { buildDefStoreExport, applyDefStoreExport, DefStoreImportError } from "../../lib/def-store-export";
import { buildFullBackup, splitFullBackup, buildSealedFullBackup, isSealedFullBackup, openSealedFullBackup, applyExtraStores, SealedBackupError, FULL_BACKUP_SCHEMA, FULL_BACKUP_VERSION, type FullBackup } from "../../lib/full-backup";
import { buildConfigDiff } from "../../lib/config-diff";
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
  recordRequestAudit(req, {
    category: "admin", action: "config-dir.refresh",
    write: true,
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
  recordRequestAudit(req, {
    category: "admin", action: "config-dir.clear-backup",
    write: true,
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

// GET /api/setup/defs-export — a portable JSON backup of EVERYTHING an admin authors into the encrypted
// stores (imported defs, selection bindings + locks, the def-write policy, custom RBAC roles). The settings
// snapshot never covered these. The deployment's encryption key never leaves — the bundle is decrypted
// plaintext the operator secures. Admin + a fresh step-up (this decrypts every customer store at once), audited.
router.get("/setup/defs-export", requireRole("admin"), requireStepUp, (req, res) => {
  const bundle = buildDefStoreExport(new Date().toISOString());
  const count = bundle.collections.reduce((n, c) => n + c.items.length, 0);
  recordRequestAudit(req, { category: "admin", action: "defs.export", write: false, meta: { collections: bundle.collections.length, items: count } });
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-defs-export.json"`)
    .send(JSON.stringify(bundle, null, 2));
});

// POST /api/setup/defs-import — reimport a def-store export into THIS instance (e.g. onto a fresh deployment
// after a full code replacement). The ONLY writer back in: every def is re-validated by its per-kind validator,
// the read-only system scope is refused, and each collection is re-encrypted under this instance's own key.
// Admin + a fresh step-up (a bulk write to every customer store), audited with the per-collection report.
router.post("/setup/defs-import", requireRole("admin"), requireStepUp, (req, res) => {
  try {
    const report = applyDefStoreExport(req.body);
    captureVersion("reimported def-store export");
    recordRequestAudit(req, { category: "admin", action: "defs.import", write: true, meta: { collections: report.written.length, skipped: report.skipped } });
    res.json({ imported: true, ...report });
  } catch (err) {
    const msg = err instanceof DefStoreImportError ? err.message : (err instanceof Error ? err.message : "Invalid export bundle");
    res.status(400).json({ imported: false, error: msg });
  }
});

// GET /api/setup/full-backup — ONE file with BOTH the settings snapshot AND the def-store export: the "take
// all my settings and defs to a new instance" artifact. Admin + a fresh step-up (it decrypts every def store),
// audited.
//   ?encrypted=1 → the SEALED variant: the COMPLETE state (secrets included) sealed under THIS deployment's
//     own key. Only ciphertext leaves; restoring elsewhere needs the same key material ("keep the encrypted
//     backup + your keys = the whole system state"). The default (plaintext) variant leaves secrets out.
router.get("/setup/full-backup", requireRole("admin"), requireStepUp, (req, res) => {
  const encrypted = req.query["encrypted"] === "1" || req.query["encrypted"] === "true";
  const now = new Date().toISOString();
  if (encrypted) {
    const sealed = buildSealedFullBackup(getSettings(), now);
    recordRequestAudit(req, { category: "admin", action: "full_backup.export", write: false, meta: { sealed: true, keyFingerprint: sealed.keyFingerprint } });
    res
      .type("application/json")
      .set("Content-Disposition", `attachment; filename="omniproject-full-backup-sealed.json"`)
      .send(JSON.stringify(sealed, null, 2));
    return;
  }
  const backup = buildFullBackup(getSettings(), now);
  const defItems = backup.defStore.collections.reduce((n, c) => n + c.items.length, 0);
  recordRequestAudit(req, { category: "admin", action: "full_backup.export", write: false, meta: { sealed: false, defCollections: backup.defStore.collections.length, defItems } });
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-full-backup.json"`)
    .send(JSON.stringify(backup, null, 2));
});

// POST /api/setup/config-diff — compare two full backups and report WHAT CHANGED (content-free: settings by
// key, defs by id + rowVersion; secrets flagged, never valued). A side omitted from the body defaults to the
// LIVE config, so { to } previews "what restoring this backup would change" and { from, to } compares two
// bundles. A sealed side is decrypted with THIS deployment's key first. Admin + a fresh step-up (it decrypts
// every store to build the live side — same surface as the export); read-only + content-free (no secrets emitted).
router.post("/setup/config-diff", requireRole("admin"), requireStepUp, (req, res) => {
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
  const now = new Date().toISOString();
  const resolveSide = (x: unknown): FullBackup => {
    if (x === undefined || x === null) return buildFullBackup(getSettings(), now); // the live config
    if (isSealedFullBackup(x)) {
      const halves = openSealedFullBackup(x); // needs this instance's key; throws SealedBackupError otherwise
      const env: FullBackup = { schema: FULL_BACKUP_SCHEMA, version: FULL_BACKUP_VERSION, createdAt: now, settings: halves.settings as FullBackup["settings"], defStore: halves.defStore as FullBackup["defStore"] };
      if (halves.stores !== undefined) env.stores = halves.stores as NonNullable<FullBackup["stores"]>;
      return env;
    }
    return x as FullBackup; // plaintext envelope — splitFullBackup inside buildConfigDiff validates its schema
  };
  try {
    const diff = buildConfigDiff(resolveSide(body.from), resolveSide(body.to), now);
    recordRequestAudit(req, { category: "admin", action: "config.diff", write: false, meta: { settingsChanged: diff.summary.settingsChanged, defsChanged: diff.summary.defsChanged + diff.summary.defsAdded + diff.summary.defsRemoved, collections: diff.summary.collectionsChanged, identical: diff.identical } });
    res.json(diff);
  } catch (err) {
    const msg = err instanceof SealedBackupError ? err.message : (err instanceof Error ? err.message : "invalid backup");
    res.status(400).json({ error: msg });
  }
});

// POST /api/setup/full-restore — restore BOTH halves from a full backup. Each half runs through its own
// validator (settings → applySnapshot; defs → applyDefStoreExport, which re-validates + re-encrypts). Admin +
// a fresh step-up, audited. Best-effort per half so a settings-only or defs-only bundle still applies what it has.
router.post("/setup/full-restore", requireRole("admin"), requireStepUp, (req, res) => {
  // A sealed backup is decrypted first (needs THIS deployment's key) and its secret-bearing settings ARE
  // restored — the AES-GCM tag proved the bundle was sealed by this instance's own key. A plaintext backup
  // applies only the non-secret keys.
  const sealed = isSealedFullBackup(req.body);
  let halves;
  try { halves = sealed ? openSealedFullBackup(req.body) : splitFullBackup(req.body); }
  catch (err) {
    const msg = err instanceof SealedBackupError ? err.message : (err instanceof Error ? err.message : "Invalid backup");
    res.status(400).json({ restored: false, error: msg }); return;
  }
  const warnings: string[] = [];
  let settingsRestored = false;
  if (halves.settings !== undefined) {
    try {
      const { patch, warnings: w } = applySnapshot(halves.settings, { allowSecrets: sealed });
      updateSettings(patch);
      warnings.push(...w);
      settingsRestored = true;
    } catch (err) { warnings.push(`settings not restored: ${err instanceof Error ? err.message : "invalid snapshot"}`); }
  }
  let defReport: ReturnType<typeof applyDefStoreExport> | null = null;
  if (halves.defStore !== undefined) {
    try { defReport = applyDefStoreExport(halves.defStore); warnings.push(...defReport.warnings); }
    catch (err) { warnings.push(`defs not restored: ${err instanceof DefStoreImportError ? err.message : (err instanceof Error ? err.message : "invalid export")}`); }
  }
  // The extra sealed stores (ai-providers + rate-card) ride only the ENCRYPTED backup, so this applies only on
  // a sealed restore — each importer re-validates its own rows.
  let storesReport: ReturnType<typeof applyExtraStores> | null = null;
  if (halves.stores !== undefined) {
    try { storesReport = applyExtraStores(halves.stores); }
    catch (err) { warnings.push(`extra stores not restored: ${err instanceof Error ? err.message : "invalid stores"}`); }
  }
  captureVersion("restored from full backup");
  recordRequestAudit(req, { category: "admin", action: "full_backup.restore", write: true, meta: { settingsRestored, defCollections: defReport?.written.length ?? 0, defSkipped: defReport?.skipped ?? 0, stores: storesReport ? Object.keys(storesReport) : [] } });
  res.json({ restored: true, settingsRestored, defStore: defReport ?? null, stores: storesReport, warnings });
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
