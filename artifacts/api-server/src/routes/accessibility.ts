import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { contextFromReq } from "../broker";
import { orgAccessibilityDefaults, setOrgAccessibilityDefaults } from "../lib/user-prefs";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

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
 *
 * LANE 2: the write is an org-config governance verb, so it's a mountCommand descriptor — the PMO-or-admin
 * union rides in `gates`, and the sealed-store precondition (`requireArtifactStore`) is the parse gate (it
 * returns null having sent its own 503 when the store is off). The action base now records a success audit
 * (accessibility-defaults.save) the hand-written route lacked — additive, no-op under default config. The
 * GET is untouched.
 */
const router = Router();

router.get("/accessibility-defaults", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json({ accessibilityDefaults: orgAccessibilityDefaults() });
});

export const accessibilityDefaultsSaveCommand: CommandDescriptor<{ body: unknown }> = {
  name: "accessibility-defaults.save",
  method: "put",
  path: "/accessibility-defaults",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req, res) => (requireArtifactStore(res) ? { body: req.body } : null),
  run: async (req, _res, { body }) => {
    const ctx = contextFromReq(req);
    const label = ctx.email ?? ctx.name ?? ctx.sub ?? null;
    return { accessibilityDefaults: setOrgAccessibilityDefaults(body, label) };
  },
  audit: "accessibility-defaults.save",
  auditCategory: "admin",
};
mountCommand(router, accessibilityDefaultsSaveCommand);

export default router;
