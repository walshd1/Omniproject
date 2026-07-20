import { Router } from "express";
import { getSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { applySettingsGuarded } from "../lib/settings-guard";
import { actorForAudit } from "../lib/audit";
import { requireRole } from "../lib/rbac";

/**
 * Custom dashboards — the LEGACY settings-bundle path (roadmap X.10). Dashboards are now DEFINITIONS authored
 * through the importer (`POST`/`PUT /api/defs`) into the encrypted def store; per the single-write-path invariant
 * the importer + editor are the ONLY writers. This route therefore survives READ-ONLY, plus exactly one permitted
 * write: **draining the slice to `[]`** (the one-time migration in `pages/Dashboards`). Any attempt to write NEW
 * dashboards here is refused with **410** and pointed at the importer, so the parallel writer can never re-open as
 * a bypass.
 */
const router = Router();

router.get("/dashboards", (_req, res) => {
  res.json({ dashboards: getSettings().dashboards ?? [] });
});

router.put("/dashboards", requireRole("pmo"), async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.["dashboards"];
  // The only write still accepted is clearing the legacy slice to empty (the migration drain). Authoring a
  // dashboard now goes through the importer, so a non-empty write here is a retired bypass → 410 Gone.
  if (!Array.isArray(value) || value.length > 0) {
    res.status(410).json({
      error: "Dashboards are now definitions — author them through the importer (POST /api/defs). The legacy settings store is read-only and accepts only an empty array to complete migration.",
    });
    return;
  }
  try {
    const guarded = await applySettingsGuarded({ dashboards: [] }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "This change needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    captureVersion("dashboards drained (migrated to definitions)");
    res.json({ dashboards: getSettings().dashboards });
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
