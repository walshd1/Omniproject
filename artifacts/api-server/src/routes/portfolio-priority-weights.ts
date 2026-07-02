import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError, DEFAULT_PRIORITY_WEIGHTS } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";

/**
 * Portfolio prioritisation scoring weights (backlog #98) — the ONLY configurable part of the
 * fund/rank/defer view. The score itself is computed live over the read model (RICE/WSJF/MoSCoW/
 * strategic-goal/benefits canonical fields) on every request by the SPA's lib/portfolio-priority.ts;
 * nothing is persisted here except how much each dimension counts. Any authenticated user may READ
 * (so the ranking renders identically for everyone); tuning the weights is PMO-gated, since it is
 * shared org config that changes which projects rise to the top. Mirrors routes/custom-reports.ts.
 */
const router = Router();

router.get("/portfolio/priority-weights", (_req, res) => {
  res.json({ priorityWeights: getSettings().priorityWeights ?? DEFAULT_PRIORITY_WEIGHTS });
});

router.put("/portfolio/priority-weights", requireRole("pmo"), (req, res) => {
  const priorityWeights = (req.body as { priorityWeights?: unknown })?.priorityWeights;
  try {
    const settings = updateSettings({ priorityWeights });
    captureVersion("portfolio priority weights updated");
    res.json({ priorityWeights: settings.priorityWeights });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
