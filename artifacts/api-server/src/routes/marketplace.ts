import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { artifactStoreEnabled, requireArtifactStore } from "../lib/artifact-store";
import {
  sanitizeExtensionInstall, newExtensionRow, setExtensionStatus, extensionMeta,
  listExtensions, getExtension, putExtension, deleteExtension, ExtensionError,
  type ExtensionMeta,
} from "../lib/extension";
import { EXTENSION_STATUSES, type ExtensionStatus } from "@workspace/backend-catalogue";

/**
 * PLUGIN MARKETPLACE routes (roadmap 3.4), behind the default-off `marketplace` feature module. An installed
 * EXTENSION is org-wide config (a manifest of pure-JSON contributions) held in the sealed artifact store.
 * Installing / enabling / removing an extension is a GOVERNANCE action ⇒ admin-gated writes; any manager+ may
 * browse what's installed. No extension carries executable code — contributions are config the app renders.
 */
const router = Router();

const isStatus = (s: unknown): s is ExtensionStatus => typeof s === "string" && (EXTENSION_STATUSES as readonly string[]).includes(s);

// GET /api/extensions — the installed extensions (contribution defs omitted) (manager+).
router.get("/extensions", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "list_extensions failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const metas: ExtensionMeta[] = listExtensions().map(extensionMeta);
    res.json(metas);
  }),
);

// GET /api/extensions/:id — one installed extension with its contributions (manager+).
router.get("/extensions/:id", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "get_extension failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Extension not found" }); return; }
    const ext = getExtension(String(req.params["id"]));
    if (!ext) { res.status(404).json({ error: "Extension not found" }); return; }
    res.json(ext);
  }),
);

// POST /api/extensions — install an extension from a manifest (admin — a governance decision).
router.post("/extensions", requireRole("admin"), (req, res) => {
  let input;
  try { input = sanitizeExtensionInstall(req.body); }
  catch (e) { if (e instanceof ExtensionError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "install_extension failed", async () => {
    if (!requireArtifactStore(res)) return;
    const row = newExtensionRow(crypto.randomUUID(), input, contextFromReq(req), new Date().toISOString());
    putExtension(row);
    res.status(201).json(row);
  });
});

// POST /api/extensions/:id/status — enable / disable an installed extension (admin).
router.post("/extensions/:id/status", requireRole("admin"), (req, res) => {
  const next = (req.body ?? {})["status"];
  if (!isStatus(next)) { res.status(400).json({ error: "status must be installed or disabled" }); return; }
  return withBrokerErrors(req, res, "toggle_extension failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Extension not found" }); return; }
    const existing = getExtension(String(req.params["id"]));
    if (!existing) { res.status(404).json({ error: "Extension not found" }); return; }
    const row = setExtensionStatus(existing, next, new Date().toISOString());
    putExtension(row);
    res.json(row);
  });
});

// DELETE /api/extensions/:id — uninstall an extension (admin).
router.delete("/extensions/:id", requireRole("admin"), (req, res) =>
  withBrokerErrors(req, res, "uninstall_extension failed", async () => {
    if (artifactStoreEnabled()) deleteExtension(String(req.params["id"]));
    res.status(204).end();
  }),
);

export default router;
