/**
 * Programme endpoints — GET /api/programmes (the derived programme roll-up across
 * projects) and /api/programmes/:id (one programme's detail). Programmes are
 * DERIVED from projects' programmeId, not stored; the grouping maths is in
 * lib/programmes, this is the read-only shell.
 */
import { Router } from "express";
import { getProjects } from "../lib/data";
import { groupProgrammes, programmeDetail } from "../lib/programmes";

const router = Router();

// GET /api/programmes — programmes derived from project membership, rolled up.
router.get("/programmes", async (req, res) => {
  try {
    res.json(groupProgrammes(await getProjects(req)));
  } catch (err) {
    req.log.error({ err }, "list_programmes failed");
    res.status(502).json({ error: "Failed to load programmes" });
  }
});

// GET /api/programmes/:programmeId — programme-wide view + member projects.
router.get("/programmes/:programmeId", async (req, res) => {
  try {
    const detail = programmeDetail(await getProjects(req), String(req.params["programmeId"]));
    if (!detail) {
      res.status(404).json({ error: "No such programme" });
      return;
    }
    res.json(detail);
  } catch (err) {
    req.log.error({ err }, "get_programme failed");
    res.status(502).json({ error: "Failed to load programme" });
  }
});

export default router;
