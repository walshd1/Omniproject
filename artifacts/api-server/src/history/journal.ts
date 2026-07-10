/**
 * The write half of retention: turn a write patch into append-only change-journal rows by diffing the
 * new values against the prior state. Pure — the caller supplies the timestamp/actor/txn id (so it's
 * deterministic and testable), and the concrete append lives in the retention source (below the seam).
 */
import type { HistoryEntry } from "./types";

export interface WriteMeta {
  changedAt: string; // ISO 8601
  changedBy: string | null;
  txnId: string;
}

/** A value "changed" unless it is deeply-equal to the prior one. 0/false/"" are real values. */
function changed(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  // Cheap structural compare for the JSON-shaped values fields carry (arrays/objects for labels etc.).
  try {
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch {
    return true; // unstringifiable (cycles) — treat as changed rather than silently drop
  }
}

/**
 * Diff `next` (the write patch) against `prev` (the entity's current stored values) into one journal
 * entry per genuinely-changed field. Fields absent from `next` are untouched (a patch, not a replace);
 * fields present with an unchanged value produce no entry. A field new to `prev` records `oldValue:
 * null`. The entries share the meta's `txnId`, so a snapshot boundary is a whole transaction.
 */
export function diffToJournal(
  entity: string,
  id: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  meta: WriteMeta,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const [field, newValue] of Object.entries(next)) {
    const oldValue = field in prev ? prev[field] : null;
    if (!changed(oldValue, newValue)) continue;
    entries.push({
      entity,
      id,
      field,
      oldValue,
      newValue,
      changedAt: meta.changedAt,
      changedBy: meta.changedBy,
      txnId: meta.txnId,
    });
  }
  return entries;
}
