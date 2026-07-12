import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { getArchiveStore } from "../lib/archive/archive-store";
import { resolveGuid } from "../lib/guid-aliases";
import { getSettings } from "../lib/settings";

/**
 * Read the self-managed ARCHIVE — the closed projects whose data was migrated out of the SOR (the
 * `archive` disposition). OmniProject holds only the index; the snapshots live in the customer-owned
 * archive store. Admin/PMO only; the actual project data never crosses into the gateway's live scope.
 * This closes the loop that planProjectSources plans: an archived source can now be retrieved by GUID.
 */
const router = Router();

// GET /api/archive/projects — the index of archived projects (guid + archivedAt).
router.get("/archive/projects", requireAnyRole("pmo", "admin"), async (req, res) => {
  try {
    res.json(await getArchiveStore().list());
  } catch (err) {
    req.log.error({ err }, "archive_list failed");
    res.status(502).json({ error: "Could not read the archive" });
  }
});

// GET /api/archive/projects/:guid — one archived project's snapshot (project + issues), relink-aware.
router.get("/archive/projects/:guid", requireAnyRole("pmo", "admin"), async (req, res) => {
  try {
    const guid = resolveGuid(String(req.params["guid"]), getSettings().guidAliases);
    const snapshot = await getArchiveStore().get(guid);
    if (!snapshot) { res.status(404).json({ error: "No archived project for that GUID" }); return; }
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "archive_get failed");
    res.status(502).json({ error: "Could not read the archive" });
  }
});

export default router;
