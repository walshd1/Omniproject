import { Router } from "express";
import { getSession } from "./auth";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";
import {
  listResolvedTools, getToolPolicy, setToolPolicy, getConsentedTools, addToolConsent, revokeToolConsent, isKnownTool,
} from "../lib/tools";

/**
 * The tools plane — the optional AI/integration capabilities, governed by the admin
 * data-egress policy and per-user consent (see lib/tools).
 *
 *  - GET    /api/tools                 — every tool resolved for the asking user
 *                                        (available? which egress mode? consent needed?),
 *                                        plus the current admin policy.
 *  - POST   /api/tools/:id/consent     — record this user's informed consent for a tool.
 *  - DELETE /api/tools/:id/consent     — withdraw it.
 *  - PUT    /api/tools/policy          — set the admin egress policy (admin only).
 */
const router = Router();

router.get("/tools", (req, res) => {
  const sub = getSession(req)?.sub;
  const consented = sub ? getConsentedTools(sub) : [];
  res.json({ tools: listResolvedTools(getToolPolicy(), consented), policy: getToolPolicy() });
});

router.post("/tools/:id/consent", (req, res) => {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "sign in to consent to a tool" }); return; }
  if (!isKnownTool(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
  res.json({ consented: addToolConsent(session.sub, req.params.id) });
});

router.delete("/tools/:id/consent", (req, res) => {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "sign in to manage consent" }); return; }
  if (!isKnownTool(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
  res.json({ consented: revokeToolConsent(session.sub, req.params.id) });
});

// Relaxing the data-egress policy is a deliberate governance decision — admin only,
// and versioned so it can be rolled back like any other config change.
router.put("/tools/policy", requireRole("admin"), (req, res) => {
  const policy = setToolPolicy(req.body ?? {});
  captureVersion("tool policy updated");
  res.json({ policy });
});

export default router;
