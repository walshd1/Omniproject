import type { ActorContext } from "../broker/types";
import { recordAudit } from "./audit";
import { proposeIfBound } from "./approval-gate";
import { registerApprovalExecutor } from "./approval-service";
import { logger } from "./logger";

/**
 * Approval-gated promotion (docs/UPDATE-MECHANISM.md §7, phase 3).
 *
 * Promoting a digest to production is a security-relevant, HUMAN-ONLY act — it ships new code. It funnels
 * through the SAME approval machinery as every other sensitive action: bound to a chain, it's held as a
 * passkey-signed proposal (params only, never code); unbound, it applies immediately. Either way the
 * decision is written to the hash-chained audit log, so which digest was promoted, by whom, and when is
 * non-repudiable. No autonomous/agentic actor can promote (enforced at the route).
 *
 * "Promotion" here records the APPROVED production digest — the authorization the deploy layer reads to pin
 * `RELEASE_EXPECTED_DIGEST` (and to sign the promotion record, §3). The runtime never holds the release key;
 * it only records + audits the decision.
 */

/** The approval-chain action id a promotion binds to — an admin can require a passkey-signed chain here. */
export const PROMOTE_ACTION = "release.promote";

/** A content digest shape: `sha256:` + hex (8–64 chars, so a short test digest and a real one both pass). */
const DIGEST_RE = /^sha256:[0-9a-f]{8,64}$/i;
export function isDigest(v: unknown): v is string {
  return typeof v === "string" && DIGEST_RE.test(v);
}

export interface ApprovedPromotion {
  digest: string;
  approvedBy: string;
  approvedAt: string;
  note?: string;
}

let current: ApprovedPromotion | null = null;

/** The digest currently approved for production (or null). The deploy layer reads this to pin the runtime. */
export function approvedPromotion(): ApprovedPromotion | null {
  return current;
}

/** Test seam: clear the recorded promotion. */
export function __resetPromotion(): void {
  current = null;
}

/**
 * Fired the moment a promotion is RECORDED (a new digest approved for prod) — the seam the auto-backup
 * (phase 4, §6) hangs off. Kept as a settable hook rather than a direct import so this module never depends
 * on the backup module (which imports `isDigest` from here) — a one-way edge, no cycle. Best-effort by
 * contract: the hook must never break the promotion decision, so `recordApprovedPromotion` guards the call.
 */
let onPromotionRecorded: ((digest: string, now: string) => void) | null = null;
export function setPromotionRecordedHook(fn: ((digest: string, now: string) => void) | null): void {
  onPromotionRecorded = fn;
}

/**
 * Record that a digest is APPROVED for production — the actual promotion decision, audited. Called directly
 * on the unbound path, and by the approval executor when a bound chain reaches sign-off.
 */
export function recordApprovedPromotion(digest: string, note: string | undefined, actorSub: string, now: string): ApprovedPromotion {
  current = { digest, approvedBy: actorSub, approvedAt: now, ...(note ? { note } : {}) };
  recordAudit({ ts: now, category: "admin", action: "release.promoted", actor: { sub: actorSub }, write: true, result: "success", meta: { digest, ...(note ? { note } : {}) } });
  logger.info({ digest, approvedBy: actorSub }, "release promoted — approved production digest recorded");
  // Auto-backup the OUTGOING state (still under the current running digest) before the new digest is adopted.
  // Best-effort: a backup failure must never void an approved promotion.
  try { onPromotionRecorded?.(digest, now); }
  catch (err) { logger.warn({ err }, "post-promotion hook (pre-adopt backup) failed — promotion still recorded"); }
  return current;
}

/**
 * The "apply once approved" body for a promotion proposal — records the approved digest from the proposal's
 * params (params only ever travel the approval queue, never code). Exported so it's directly testable.
 */
export function runPromotionExecutor(params: unknown): void {
  const p = (params ?? {}) as { digest?: string; note?: string; actorSub?: string };
  if (!p.digest) throw new Error("release.promote executor: proposal is missing its digest");
  recordApprovedPromotion(p.digest, p.note, p.actorSub ?? "unknown", new Date().toISOString());
}

/** Register the approval executor so a bound, passkey-approved promotion actually records on sign-off. */
export function ensurePromotionExecutor(): void {
  registerApprovalExecutor(PROMOTE_ACTION, runPromotionExecutor);
}

export interface PromoteOutcome {
  held: boolean;
  proposalId?: string;
  promotion?: ApprovedPromotion;
}

/**
 * Propose a promotion. If an approval chain is bound to `release.promote`, the run is HELD as a passkey-signed
 * proposal (nothing recorded until sign-off); otherwise it records immediately. The caller (route) has already
 * refused autonomous actors — promotion is human-only.
 */
export async function proposePromotion(ctx: ActorContext, digest: string, note: string | undefined): Promise<PromoteOutcome> {
  const actorSub = ctx.sub ?? "unknown";
  const proposalId = await proposeIfBound(PROMOTE_ACTION, { digest, note, actorSub }, actorSub);
  if (proposalId) return { held: true, proposalId };
  const promotion = recordApprovedPromotion(digest, note, actorSub, new Date().toISOString());
  return { held: false, promotion };
}
