import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { contextFromReq } from "../broker";
import { isAutonomous } from "../lib/autonomous";
import { approvedPromotion, proposePromotion, isDigest, ensurePromotionExecutor } from "../lib/release-promotion";
import {
  captureReleaseBackup, latestReleaseBackupMeta, proposeRestore,
  ensureRestoreExecutor, ensurePreAdoptBackupHook,
} from "../lib/release-backup";

/**
 * Release promotion (docs/UPDATE-MECHANISM.md §7, phase 3). `POST /api/admin/release/promote` approves a
 * digest for production — HUMAN-ONLY, and held for a passkey-signed chain when one is bound to
 * `release.promote`. `GET /api/admin/release/promotion` reads the currently-approved digest (what the deploy
 * layer pins). The actual repoint-to-prod is a deploy-layer act on the approved digest.
 */
const router = Router();

// Register the approval executors + auto-backup hook at mount time, so a bound promotion/restore fires when
// its chain reaches sign-off, and every recorded promotion first snapshots the outgoing state (phase 4, §6).
ensurePromotionExecutor();
ensureRestoreExecutor();
ensurePreAdoptBackupHook();

router.get("/admin/release/promotion", requireRole("admin"), (_req, res) => {
  res.json({ promotion: approvedPromotion() });
});

// GET /api/admin/release/backup — non-secret metadata of the stored pre-adopt backup (digest + when).
router.get("/admin/release/backup", requireRole("admin"), (_req, res) => {
  res.json({ backup: latestReleaseBackupMeta() });
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

// POST /api/admin/release/backup — capture a pre-adopt backup NOW, tagged with the running digest. LANE 2.
// Admin-only; a capture is a safe, read-then-seal action (no live state is changed), so it is not
// approval-gated and does not refuse autonomous callers.
export const backupCaptureCommand: CommandDescriptor<Record<string, never>> = {
  name: "release.backup.capture",
  method: "post",
  path: "/admin/release/backup",
  role: "admin",
  parse: () => ({}),
  run: async () => {
    const backup = captureReleaseBackup(new Date().toISOString());
    return { captured: true, backup: { takenAt: backup.takenAt, digest: backup.digest, keyFingerprint: backup.keyFingerprint } };
  },
  audit: "release.backup.capture",
  auditCategory: "admin",
};
mountCommand(router, backupCaptureCommand);

// POST /api/admin/release/restore — restore the pre-adopt backup, BOUND to a rollback digest. LANE 2.
// A restore overwrites live state (settings, defs, security state), so — like promotion — it is HUMAN-ONLY
// and held for a passkey-signed chain when one is bound to `release.restore`.
export const restoreCommand: CommandDescriptor<{ digest: string }> = {
  name: "release.restore",
  method: "post",
  path: "/admin/release/restore",
  role: "admin",
  parse: (req, res) => {
    if (isAutonomous(contextFromReq(req))) { res.status(403).json({ error: "restore is a human-only action" }); return null; }
    const body = (req.body ?? {}) as { digest?: unknown };
    if (!isDigest(body.digest)) { res.status(400).json({ error: "digest must be a content digest (sha256:…)" }); return null; }
    return { digest: body.digest };
  },
  run: async (req, res, args) => {
    const outcome = await proposeRestore(contextFromReq(req), args.digest);
    if (outcome.held) {
      res.status(202).json({ held: true, pending: outcome.proposalId, message: "restore held for approval sign-off" });
      return undefined; // 202 already sent
    }
    // A refused restore (no backup / digest mismatch / undecryptable) is a client-visible 409, not a 500.
    if (!outcome.outcome?.restored) {
      res.status(409).json({ restored: false, error: outcome.outcome?.reason ?? "restore refused" });
      return undefined;
    }
    return { restored: true, result: outcome.outcome };
  },
  audit: "release.restore",
  auditCategory: "admin",
  auditMeta: (_req, args) => ({ digest: args.digest }),
};
mountCommand(router, restoreCommand);

export default router;
