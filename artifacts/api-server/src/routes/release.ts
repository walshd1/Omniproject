import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { contextFromReq } from "../broker";
import { isAutonomous } from "../lib/autonomous";
import { approvedPromotion, proposePromotion, isDigest, ensurePromotionExecutor } from "../lib/release-promotion";

/**
 * Release promotion (docs/UPDATE-MECHANISM.md §7, phase 3). `POST /api/admin/release/promote` approves a
 * digest for production — HUMAN-ONLY, and held for a passkey-signed chain when one is bound to
 * `release.promote`. `GET /api/admin/release/promotion` reads the currently-approved digest (what the deploy
 * layer pins). The actual repoint-to-prod is a deploy-layer act on the approved digest.
 */
const router = Router();

// Register the approval executor at mount time so a bound promotion fires when its chain reaches sign-off.
ensurePromotionExecutor();

router.get("/admin/release/promotion", requireRole("admin"), (_req, res) => {
  res.json({ promotion: approvedPromotion() });
});

// POST /api/admin/release/promote — approve a digest for production. LANE 2 (mountCommand).
export const promoteCommand: CommandDescriptor<{ digest: string; note?: string }> = {
  name: "release.promote",
  method: "post",
  path: "/admin/release/promote",
  role: "admin",
  parse: (req, res) => {
    // Human-only: promoting new code to prod can never be done by an autonomous/agentic actor.
    if (isAutonomous(contextFromReq(req))) { res.status(403).json({ error: "promotion is a human-only action" }); return null; }
    const body = (req.body ?? {}) as { digest?: unknown; note?: unknown };
    if (!isDigest(body.digest)) { res.status(400).json({ error: "digest must be a content digest (sha256:…)" }); return null; }
    return { digest: body.digest, ...(typeof body.note === "string" ? { note: body.note } : {}) };
  },
  run: async (req, res, args) => {
    const outcome = await proposePromotion(contextFromReq(req), args.digest, args.note);
    if (outcome.held) {
      res.status(202).json({ held: true, pending: outcome.proposalId, message: "promotion held for approval sign-off" });
      return undefined; // 202 already sent
    }
    return { held: false, promotion: outcome.promotion };
  },
  audit: "release.promote",
  auditCategory: "admin",
  auditMeta: (_req, args) => ({ digest: args.digest }),
};
mountCommand(router, promoteCommand);

export default router;
