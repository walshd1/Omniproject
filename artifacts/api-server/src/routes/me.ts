import { Router } from "express";
import { getSession } from "./auth";
import { effectiveDefaultPrefs, orgAccessibilityDefaults, getUserPrefs, hasUserPrefs, setUserPrefs } from "../lib/user-prefs";

/**
 * The signed-in user's own preferences.
 *
 *  - GET  /api/me/prefs — this user's persisted UI/accessibility prefs (with
 *    `stored` telling the client whether they came from a saved entry or the code
 *    defaults, so it won't clobber a local setup pre-login).
 *  - PUT  /api/me/prefs — save this user's prefs (so their setup follows them across
 *    sessions/devices). Requires a session.
 */
const router = Router();

router.get("/me/prefs", (req, res) => {
  // `orgDefaults` is the org accessibility layer BENEATH the user's leaf — the client can show which values are
  // inherited from the org vs. the user's own. `prefs` is already resolved (user leaf wins, else org, else code).
  const orgDefaults = orgAccessibilityDefaults();
  const s = getSession(req);
  if (!s) { res.json({ prefs: effectiveDefaultPrefs(), stored: false, orgDefaults }); return; }
  res.json({ prefs: getUserPrefs(s.sub), stored: hasUserPrefs(s.sub), orgDefaults });
});

router.put("/me/prefs", (req, res) => {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign in to save preferences" }); return; }
  res.json({ prefs: setUserPrefs(s.sub, req.body), stored: true });
});

export default router;
