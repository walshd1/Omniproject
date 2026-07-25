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
import { startCanary, acceptCanary, rejectCanary, canaryView } from "../lib/release-canary";

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

// GET /api/admin/release/canary — the current canary's state (digest under test + accept/reject state).
router.get("/admin/release/canary", requireRole("admin"), (_req, res) => {
  res.json({ canary: canaryView() });
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

// POST /api/admin/release/canary — start a canary for a digest: seed an isolated data copy and record
// `testing`. LANE 2. Admin-only; seeding is a safe read-then-seal (like backup capture), so not gated.
export const canaryStartCommand: CommandDescriptor<{ digest: string }> = {
  name: "release.canary.start",
  method: "post",
  path: "/admin/release/canary",
  role: "admin",
  parse: (req, res) => {
    const body = (req.body ?? {}) as { digest?: unknown };
    if (!isDigest(body.digest)) { res.status(400).json({ error: "digest must be a content digest (sha256:…)" }); return null; }
    return { digest: body.digest };
  },
  run: async (req, res, args) => {
    const outcome = startCanary(contextFromReq(req), args.digest, new Date().toISOString());
    if (!outcome.started) { res.status(409).json({ started: false, error: outcome.reason }); return undefined; }
    return { started: true, canary: outcome.canary };
  },
  audit: "release.canary.start",
  auditCategory: "admin",
  auditMeta: (_req, args) => ({ digest: args.digest }),
};
mountCommand(router, canaryStartCommand);

// POST /api/admin/release/canary/accept — accept the canary → promote its digest (funnels the SAME human-only
// `release.promote` chain). LANE 2, human-only.
export const canaryAcceptCommand: CommandDescriptor<Record<string, never>> = {
  name: "release.canary.accept",
  method: "post",
  path: "/admin/release/canary/accept",
  role: "admin",
  parse: (req, res) => {
    if (isAutonomous(contextFromReq(req))) { res.status(403).json({ error: "accepting a canary is a human-only action" }); return null; }
    return {};
  },
  run: async (req, res) => {
    const outcome = await acceptCanary(contextFromReq(req), new Date().toISOString());
    if (!outcome.accepted) { res.status(409).json({ accepted: false, error: outcome.reason }); return undefined; }
    if (outcome.promotion?.held) {
      res.status(202).json({ accepted: true, held: true, pending: outcome.promotion.proposalId, message: "canary accepted — promotion held for approval sign-off" });
      return undefined;
    }
    return { accepted: true, promotion: outcome.promotion };
  },
  audit: "release.canary.accept",
  auditCategory: "admin",
};
mountCommand(router, canaryAcceptCommand);

// POST /api/admin/release/canary/reject — reject the canary → discard it (isolated writes dropped). LANE 2,
// human-only.
export const canaryRejectCommand: CommandDescriptor<Record<string, never>> = {
  name: "release.canary.reject",
  method: "post",
  path: "/admin/release/canary/reject",
  role: "admin",
  parse: (req, res) => {
    if (isAutonomous(contextFromReq(req))) { res.status(403).json({ error: "rejecting a canary is a human-only action" }); return null; }
    return {};
  },
  run: async (req, res) => {
    const outcome = rejectCanary(contextFromReq(req), new Date().toISOString());
    if (!outcome.rejected) { res.status(409).json({ rejected: false, error: outcome.reason }); return undefined; }
    return { rejected: true, canary: outcome.canary };
  },
  audit: "release.canary.reject",
  auditCategory: "admin",
};
mountCommand(router, canaryRejectCommand);

export default router;
