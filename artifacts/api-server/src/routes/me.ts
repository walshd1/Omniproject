import { Router } from "express";
import { getSession } from "./auth";
import { effectiveDefaultPrefs, orgAccessibilityDefaults, getUserPrefs, hasUserPrefs, setUserPrefs } from "../lib/user-prefs";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { listCapabilities, effectiveState } from "../lib/capability-governance";
import { grantedCapabilitiesForReq } from "../lib/custom-roles";

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

// GET /api/me/capabilities — the governed capabilities ENABLED for this caller: effective state is not "off",
// or a custom-role permission set lifts the gate for them. A UX hint so the SPA can hide a surface whose
// capability is turned off (e.g. the Invoices nav when `finance:ar` is off); the server still enforces the
// gate at each route. A pure read — no audit, no side effects.
router.get("/me/capabilities", (req, res) => {
  const granted = grantedCapabilitiesForReq(req);
  const enabled = listCapabilities().map((c) => c.id).filter((id) => effectiveState(id) !== "off" || granted.has(id));
  res.json({ enabled });
});

/**
 * PUT /api/me/prefs — save this user's own prefs (so their setup follows them across sessions/devices).
 *
 * LANE 2: a per-user write (no role floor — the caller's own prefs). The session check is the parse gate (401
 * when signed out); run persists via setUserPrefs and returns the saved prefs. The action base records a
 * success audit (me-prefs.save) the hand-written route lacked — additive, no-op under default config.
 */
export const mePrefsSaveCommand: CommandDescriptor<{ sub: string; body: unknown }> = {
  name: "me-prefs.save",
  method: "put",
  path: "/me/prefs",
  parse: (req, res) => {
    const s = getSession(req);
    if (!s) { res.status(401).json({ error: "sign in to save preferences" }); return null; }
    return { sub: s.sub, body: req.body };
  },
  run: async (_req, _res, { sub, body }) => ({ prefs: setUserPrefs(sub, body), stored: true }),
  audit: "me-prefs.save",
};
mountCommand(router, mePrefsSaveCommand);

export default router;
