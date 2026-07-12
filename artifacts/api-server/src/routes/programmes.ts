/**
 * Programme endpoints — GET /api/programmes (the derived programme roll-up across
 * projects) and /api/programmes/:id (one programme's detail). Programmes are
 * DERIVED from projects' programmeId UNIONED with the admin-managed GUID-list
 * membership (programmeMembership), not stored as an entity; the grouping maths is
 * in lib/programmes, this is the read-only shell. Runs over the already scope-filtered
 * project list, so RBAC still bounds what a caller sees.
 */
import { Router } from "express";
import { getProjects, getTasks, brokerHasTasks } from "../lib/data";
import { groupProgrammes, programmeDetail } from "../lib/programmes";
import { summariseTasks } from "../lib/task-summary";
import { getSettings } from "../lib/settings";

const router = Router();

// GET /api/programmes — programmes derived from project membership, rolled up.
router.get("/programmes", async (req, res) => {
  try {
    res.json(groupProgrammes(await getProjects(req), getSettings().programmeRegistry));
  } catch (err) {
    req.log.error({ err }, "list_programmes failed");
    res.status(502).json({ error: "Failed to load programmes" });
  }
});

// GET /api/programmes/:programmeId — programme-wide view + member projects.
router.get("/programmes/:programmeId", async (req, res) => {
  try {
    const detail = programmeDetail(await getProjects(req), String(req.params["programmeId"]), getSettings().programmeRegistry);
    if (!detail) {
      res.status(404).json({ error: "No such programme" });
      return;
    }
    // Fold a task roll-up across this programme's member projects, when the backend models tasks.
    if (brokerHasTasks()) {
      const projIds = new Set(detail.projects.map((p) => String(p["id"])));
      const tasks = (await getTasks(req)).filter((t) => t.projectId && projIds.has(t.projectId));
      detail.tasks = summariseTasks(tasks);
    }
    res.json(detail);
  } catch (err) {
    req.log.error({ err }, "get_programme failed");
    res.status(502).json({ error: "Failed to load programme" });
  }
});

export default router;
