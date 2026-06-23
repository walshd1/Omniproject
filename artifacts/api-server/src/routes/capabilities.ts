import { Router } from "express";
import { resolveCapabilities } from "../lib/capabilities";

const router = Router();

// GET /api/capabilities — which data domains the backend(s) can populate.
router.get("/capabilities", async (req, res) => {
  try {
    res.json(await resolveCapabilities(req));
  } catch (err) {
    req.log.error({ err }, "capabilities resolution failed");
    res.status(502).json({ error: "Could not resolve capabilities" });
  }
});

export default router;
