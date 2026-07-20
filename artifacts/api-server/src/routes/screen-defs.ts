import { Router } from "express";
import { getSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { applySettingsGuarded } from "../lib/settings-guard";
import { actorForAudit } from "../lib/audit";
import { requireRole } from "../lib/rbac";
import { resolveScreenDefs } from "../lib/screen-store";

/**
 * Org-authored SCREEN DEFINITIONS (roadmap X.10 — screens convergence). Screen overrides are now DEFINITIONS
 * authored through the importer (`POST`/`PUT /api/defs`, kind `screen`) into the encrypted def store; the SPA
 * merges them over its built-in catalogue by id. This legacy slice survives READ-ONLY, plus one permitted
 * write: **draining to `[]`** (the one-time migration in the Screens admin). GET stays so the migration can
 * read the old list; a non-empty write is a retired bypass → 410 Gone. `GET /screen-defs/resolved` serves the
 * effective override set (legacy bridge + def store, def store winning) the SPA renders from.
 */
const router = Router();

router.get("/screen-defs", (_req, res) => {
  res.json({ screenDefs: getSettings().screenDefs ?? [] });
});

// GET /api/screen-defs/resolved — the effective override set (legacy settings bridge + org/project/user
// def-store screens, def store winning). The SPA merges THESE over its built-in catalogue.
router.get("/screen-defs/resolved", (req, res) => {
  res.json({ screenDefs: resolveScreenDefs(req) });
});

router.put("/screen-defs", requireRole("pmo"), async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.["screenDefs"];
  if (!Array.isArray(value) || value.length > 0) {
    res.status(410).json({
      error: "Screens are now definitions — author them through the importer (POST /api/defs, kind \"screen\"). The legacy settings store is read-only and accepts only an empty array to complete migration.",
    });
    return;
  }
  try {
    const guarded = await applySettingsGuarded({ screenDefs: [] }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "This change needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    captureVersion("screen defs drained (migrated to definitions)");
    res.json({ screenDefs: getSettings().screenDefs });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
