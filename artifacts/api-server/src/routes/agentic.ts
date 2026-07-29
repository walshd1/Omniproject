import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { requireRole, hasRole, ROLES } from "../lib/rbac";
import type { Actor } from "../lib/approval-chain";
import { proposeBatch, pendingBatchesFor } from "../lib/agentic-batch-run";
import { BatchPlanError } from "../lib/agentic-batch";

/** The human approver identity for this request, or null for no session / an autonomous (non-human) principal.
 *  Mirrors routes/approvals.ts `actorFor` — an AI/agent can never be an approver here. */
function humanActor(req: Request): Actor | null {
  const s = getSession(req);
  if (!s?.sub || /^(?:automation|agent):/i.test(s.sub)) return null;
  return { sub: s.sub, roles: ROLES.filter((r) => hasRole(req, r)), via: "human" };
}

/**
 * Supervised agentic execution (D1) — the PLAN→PROPOSE surface ("approve-the-batch").
 *
 *   POST /api/agentic/batches  — submit a planned batch of low-risk actions; the server validates it against
 *                                the executable allowlist and raises ONE approval proposal a human must sign
 *                                off. Nothing executes here: on approval, the batch runs under a just-in-time
 *                                autonomous grant (minted + torn down inside that run). 202 + {batchId,
 *                                proposalId, preview}.
 *
 * Proposing needs contributor (you may only automate what you could do by hand) and an interactive session.
 * The feature is OFF until an operator binds an approval chain to it — an unconfigured gateway returns 409.
 */
const router: IRouter = Router();

router.post("/agentic/batches", requireRole("contributor"), async (req: Request, res: Response) => {
  const sub = getSession(req)?.sub;
  if (!sub) { res.status(403).json({ error: "supervised batches require an interactive session" }); return; }
  try {
    const result = await proposeBatch((req.body as { plan?: unknown } | undefined)?.plan, sub);
    res.status(202).json(result); // accepted, pending human approval
  } catch (err) {
    if (err instanceof BatchPlanError) {
      // "not enabled" ⇒ no approval chain is bound (a server-config state) → 409; anything else is a bad plan → 400.
      res.status(/not enabled/.test(err.message) ? 409 : 400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// GET /api/agentic/batches/pending — the supervised batches awaiting THIS caller's sign-off, each with its
// plan + a fresh dry-run preview so the approver reviews the exact actions before approving/aborting. Only
// batches the caller is eligible to decide (and didn't propose) are returned. A human session is required —
// an autonomous principal can never approve a batch.
router.get("/agentic/batches/pending", requireRole("contributor"), async (req: Request, res: Response) => {
  const actor = humanActor(req);
  if (!actor) { res.status(403).json({ error: "reviewing supervised batches requires an interactive session" }); return; }
  res.json({ pending: await pendingBatchesFor(actor) });
});

export default router;
