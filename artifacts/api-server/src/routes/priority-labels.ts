import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { requireAnyRole } from "../lib/rbac";
import { CANONICAL_PRIORITY } from "../broker/vocabulary";

/**
 * Custom display names for the canonical priority levels. Admin/PMO can relabel them (e.g. urgent →
 * "P0", high → "Critical"); an empty map means the canonical names. Kept separate from the premium
 * company-nomenclature labels so it's available without that entitlement — a basic governance knob.
 */
const router = Router();

// GET /api/priority-labels — the canonical levels + the current custom labels (any authed user, for display).
router.get("/priority-labels", (_req, res) => {
  res.json({ canonical: CANONICAL_PRIORITY, labels: getSettings().priorityLabels ?? {} });
});

// PUT /api/priority-labels — set the custom labels (admin or PMO). Body: { labels: { high: "Critical", … } }.
router.put("/priority-labels", requireAnyRole("pmo", "admin"), (req, res) => {
  const labels = (req.body as { labels?: unknown })?.labels;
  try {
    const saved = updateSettings({ priorityLabels: labels ?? {} }).priorityLabels;
    res.json({ canonical: CANONICAL_PRIORITY, labels: saved });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
