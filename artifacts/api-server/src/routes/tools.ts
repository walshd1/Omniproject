import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";
import { getSession } from "./auth";
import {
  listResolvedCapabilities, listSurfaces, setCapabilityState, noteCapabilityConfigured,
  recentCapabilityLog, UnknownCapabilityError,
} from "../lib/tools";

/**
 * Capability governance plane — the admin-set deployment state (off / user-defined /
 * public, and per-surface for AI tools) of every AI tool, the MCP, AI providers and
 * vendors (see lib/tools).
 *
 *  - GET /api/governance         — every capability with its offered states + current
 *                                  setting (readable by any authenticated session, so
 *                                  the UI can honour the states).
 *  - PUT /api/governance/:id     — set one capability's state/endpoint/surfaces (admin).
 */
const router = Router();

router.get("/governance", (_req, res) => {
  res.json({ capabilities: listResolvedCapabilities(), surfaces: listSurfaces() });
});

// Live activity for the admin governance dashboard (uses, blocks, config changes).
router.get("/governance/log", requireRole("admin"), (_req, res) => {
  res.json({ entries: recentCapabilityLog() });
});

// Changing any capability's deployment state is an admin decision, and versioned so
// it can be rolled back like any other config change.
router.put("/governance/:id", requireRole("admin"), (req, res) => {
  const id = String(req.params["id"]);
  const session = getSession(req);
  try {
    const setting = setCapabilityState(id, req.body ?? {});
    noteCapabilityConfigured(id, setting, session ? { sub: session.sub, email: session.email, role: session.roles?.[0] } : null);
    captureVersion(`capability ${id} set`);
    res.json({ setting });
  } catch (err) {
    if (err instanceof UnknownCapabilityError) { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
