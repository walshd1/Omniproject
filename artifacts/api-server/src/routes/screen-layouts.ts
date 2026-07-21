import { Router } from "express";
import { getSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { applySettingsGuarded } from "../lib/settings-guard";
import { actorForAudit } from "../lib/audit";
import { requireRole } from "../lib/rbac";

/**
 * Per-screen saved LAYOUTS — the drag-customised arrangement (panel order / spans / hidden). Roadmap X.10:
 * a saved layout is now FOLDED INTO the screen def (it rides on the org `screen` def in the encrypted def
 * store, authored through the importer), so this legacy `screenLayouts` settings map survives READ-ONLY as a
 * migration bridge, plus one permitted write: **draining to `{}`** (the one-time migration in the Screens
 * admin). A non-empty write is a retired bypass → 410 Gone. WRITE gated to `pmo`, like before.
 */
const router = Router();

router.get("/screen-layouts", (_req, res) => {
  res.json({ screenLayouts: getSettings().screenLayouts ?? {} });
});

router.put("/screen-layouts", requireRole("pmo"), async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.["screenLayouts"];
  const isEmptyObject = value != null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  if (!isEmptyObject) {
    res.status(410).json({
      error: "Screen layouts are now folded into the screen definition — arrange a screen via its Edit-layout mode (saved through the importer). The legacy settings store is read-only and accepts only an empty object to complete migration.",
    });
    return;
  }
  try {
    const guarded = await applySettingsGuarded({ screenLayouts: {} }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "This change needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    captureVersion("screen layouts drained (folded into screen defs)");
    res.json({ screenLayouts: getSettings().screenLayouts });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
