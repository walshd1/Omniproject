/**
 * Retention LIFECYCLE governance — the data-disposal / legal-hold / right-to-erasure policy layer over
 * the durable history store (closes the GDPR storage-limitation + erasure gap for the OPTIONAL retention
 * store; the gateway stays zero-at-rest, the deletes execute below the seam via the RetentionSource).
 *
 * Three controls, in strict precedence:
 *   1. LEGAL HOLD wins over everything — a held `entity#id` is never disposed and never erased.
 *   2. RETENTION WINDOW (`retentionDays`) — disposal prunes rows older than the window; null ⇒ infinite.
 *   3. ERASURE — an explicit DSAR delete of one entity's history (still blocked by a legal hold).
 *
 * Pure over the injected source + the settings snapshot, so it is deterministic and unit-testable;
 * `nowMs` is a parameter (never a hidden clock read) so tests pin the cutoff.
 */
import { resolveHistoryRetention, legalHoldsNow } from "../lib/history-retention";
import type { RetentionSource, DisposalResult } from "./retention";

const DAY_MS = 86_400_000;

/** The canonical legal-hold key for an entity id. */
export const holdKey = (entity: string, id: string): string => `${entity}#${id}`;

/** The configured legal-hold key set (from the `history-retention` config def). */
export function legalHoldSet(): Set<string> {
  return new Set(legalHoldsNow());
}

/** Whether an entity id is under legal hold (exempt from disposal AND erasure). */
export function isUnderLegalHold(entity: string, id: string): boolean {
  return legalHoldSet().has(holdKey(entity, id));
}

/** The disposal cutoff (ISO) for a window in days, or null when retention is infinite (window unset). */
export function disposalCutoff(retentionDays: number | null | undefined, nowMs: number): string | null {
  if (retentionDays == null || retentionDays < 1) return null;
  return new Date(nowMs - retentionDays * DAY_MS).toISOString();
}

/** Thrown when erasure/disposal is refused because the target is under legal hold. */
export class LegalHoldError extends Error {
  constructor(entity: string, id: string) {
    super(`"${entity}#${id}" is under legal hold — release the hold before disposal or erasure`);
    this.name = "LegalHoldError";
  }
}

/** Thrown when the configured retention source does not implement the requested lifecycle operation. */
export class RetentionUnsupportedError extends Error {
  constructor(op: "disposal" | "erasure") {
    super(`the configured retention source does not support ${op}`);
    this.name = "RetentionUnsupportedError";
  }
}

export interface DisposalRun extends DisposalResult {
  /** Whether disposal actually ran (false ⇒ infinite retention, nothing to do). */
  disposed: boolean;
  /** The cutoff applied, or null when retention is infinite. */
  cutoff: string | null;
}

/**
 * Run disposal for a source per the configured retention window, skipping legal-held keys. A no-op
 * (disposed:false) when the window is unset — infinite retention is the safe default, never a silent prune.
 */
export async function disposeExpired(source: RetentionSource, nowMs: number): Promise<DisposalRun> {
  const cfg = resolveHistoryRetention();
  const cutoff = disposalCutoff(cfg.retentionDays, nowMs);
  if (!cutoff) return { disposed: false, cutoff: null, snapshots: 0, journal: 0 };
  if (!source.disposeOlderThan) throw new RetentionUnsupportedError("disposal");
  const result = await source.disposeOlderThan(cutoff, { heldKeys: cfg.legalHolds ?? [] });
  return { disposed: true, cutoff, snapshots: result.snapshots, journal: result.journal };
}

/**
 * Erase ALL history for one entity id (right-to-erasure / DSAR). Refuses when the key is under legal
 * hold. The caller is responsible for authorization (admin + step-up) BEFORE invoking this.
 */
export async function eraseEntityHistory(source: RetentionSource, entity: string, id: string): Promise<DisposalResult> {
  if (isUnderLegalHold(entity, id)) throw new LegalHoldError(entity, id);
  if (!source.eraseEntity) throw new RetentionUnsupportedError("erasure");
  return source.eraseEntity(entity, id);
}
