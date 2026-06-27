import { Router } from "express";
import { backendCatalogue } from "@workspace/backend-catalogue";
import { devModeStatus, isDevMode } from "../lib/dev-mode";
import { requireRole } from "../lib/rbac";
import { getDevBrokerConfig, setDevBrokerConfig, DEV_DATA_SOURCES, type DevDataSource } from "../broker/dev-broker";
import { resetBroker } from "../broker";

/**
 * Dev-mode routes.
 *
 *  - GET  /api/dev-mode — public status (which debug surfaces are armed), so the SPA
 *    can watermark the screen even pre-auth. Always `devMode:false` in production.
 *  - GET  /api/dev-mode/broker — the current dev-broker config + the vendor/source
 *    options (dev only, admin).
 *  - POST /api/dev-mode/broker — switch the spoofed vendor × data source ON THE FLY
 *    (dev only, admin). Resets the broker so the next request uses the new combo.
 *
 * The switch endpoints are inert in production (dev mode is gated off there) and
 * admin-gated; nothing here exists on a released deployment.
 */
const router = Router();

router.get("/dev-mode", (_req, res) => {
  res.json(devModeStatus());
});

router.get("/dev-mode/broker", requireRole("admin"), (_req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  res.json({
    config: getDevBrokerConfig(),
    sources: DEV_DATA_SOURCES,
    vendors: backendCatalogue().map((b) => ({ id: b.id, label: b.label })),
  });
});

router.post("/dev-mode/broker", requireRole("admin"), (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  const body = (req.body ?? {}) as { vendor?: unknown; source?: unknown; ref?: unknown };
  const patch: Partial<{ vendor: string | null; source: DevDataSource; ref: string | null }> = {};

  if (body.vendor !== undefined) {
    const v = typeof body.vendor === "string" ? body.vendor.trim() : "";
    if (v && !backendCatalogue().some((b) => b.id === v)) {
      res.status(400).json({ error: `unknown vendor "${v}"` });
      return;
    }
    patch.vendor = v || null;
  }
  if (body.source !== undefined) {
    if (!DEV_DATA_SOURCES.includes(body.source as DevDataSource)) {
      res.status(400).json({ error: `source must be one of ${DEV_DATA_SOURCES.join(", ")}` });
      return;
    }
    patch.source = body.source as DevDataSource;
  }
  if (body.ref !== undefined) {
    patch.ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : null;
  }

  const config = setDevBrokerConfig(patch);
  if ((config.source === "bundle" || config.source === "cassette") && !config.ref) {
    res.status(400).json({ error: `the '${config.source}' source needs a 'ref' file path` });
    return;
  }
  resetBroker(); // next getBroker() rebuilds with the new combo
  res.json({ switched: true, config });
});

export default router;
