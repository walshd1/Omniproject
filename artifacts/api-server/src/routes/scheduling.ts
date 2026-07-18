import { Router } from "express";
import { getSession } from "./auth";
import { resolveScheduling, type ConfigScopes } from "../lib/scoped-config";

/**
 * The effective working-time policy for the (client-side, projected) scheduling engine, RESOLVED across scopes.
 *
 * This is the migration seam: the schedule config is no longer read straight off org `settings.scheduling` — it
 * is scope-layered (system < org < programme < project < user) via a `config` def, so a programme/project/user
 * can override the org calendar without any bespoke override machinery (see `scoped-config`). The org's existing
 * `settings.scheduling` remains a compatibility layer until a later slice drains it, so a deployment that
 * authors no config defs sees no behaviour change.
 *
 *  - GET /api/scheduling/resolved?programmeId=&projectId= — the folded SchedulingConfig at the given scope. The
 *    user layer is the signed-in user's own `scheduling` config def (if any). Any authed user, for the client
 *    scheduler which computes the actual schedule live and never persists it.
 */
const router = Router();

router.get("/scheduling/resolved", (req, res) => {
  const q = req.query as Record<string, unknown>;
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  const s = getSession(req);
  if (s) scopes.sub = s.sub;
  res.json({ scheduling: resolveScheduling(scopes) });
});

export default router;
