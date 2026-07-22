import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { contextFromReq } from "../broker";
import { orgAccessibilityDefaults, setOrgAccessibilityDefaults } from "../lib/user-prefs";

/**
 * The ORG-wide accessibility DEFAULTS — a partial UserPrefs the org sets as everyone's starting point (a default
 * font, reduced motion for a sensitive environment, …). Held in the composition model as a scope-layered
 * `accessibility-defaults` config def (NOT a settings key), it sits BENEATH each user's own accessibility leaf:
 * a user who hasn't personalised inherits it; a user who has always wins (user-final policy — the org may only
 * DEFAULT, never LOCK). Programme/project may also default (deeper config-def layers); the user vault is not a
 * layer here (see lib/user-prefs).
 *
 *  - GET /api/accessibility-defaults — the org-scope defaults (admin/PMO, for the editor).
 *  - PUT /api/accessibility-defaults — set them (admin/PMO). Body: a partial UserPrefs (only the named fields).
 *
 * The signed-in user's OWN prefs live at /api/me/prefs (any authed user) — a different surface.
 */
const router = Router();

router.get("/accessibility-defaults", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json({ accessibilityDefaults: orgAccessibilityDefaults() });
});

router.put("/accessibility-defaults", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  const ctx = contextFromReq(req);
  const label = ctx.email ?? ctx.name ?? ctx.sub ?? null;
  const saved = setOrgAccessibilityDefaults(req.body, label);
  res.json({ accessibilityDefaults: saved });
});

export default router;
