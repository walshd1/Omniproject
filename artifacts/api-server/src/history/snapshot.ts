/**
 * The read half of retention: fold the append-only journal into point-in-time snapshots. A snapshot
 * is DERIVED from the journal (never a second source of truth), so it's a materialised cache — cheap
 * to keep infinitely (the operator-confirmed posture) because it's just the journal's running state.
 */
import type { EntitySnapshot, HistoryEntry, Provenance } from "./types";

/** Apply every journal entry with `changedAt <= asOf`, in time order, over an optional base state. */
export function foldTo(
  entries: readonly HistoryEntry[],
  asOf: string,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...base };
  const upTo = entries
    .filter((e) => e.changedAt <= asOf)
    .sort((a, b) => (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : 0));
  for (const e of upTo) values[e.field] = e.newValue;
  return values;
}

/** Materialise one entity's snapshot as of a time — the fold of its journal up to that instant. */
export function materialiseSnapshot(
  entity: string,
  id: string,
  entries: readonly HistoryEntry[],
  asOf: string,
  base: Record<string, unknown> = {},
  provenance: Provenance = "replayed",
): EntitySnapshot {
  return { entity, id, asOf, values: foldTo(entries, asOf, base), provenance };
}

/**
 * Produce a snapshot at each boundary time (cadence.ts computes the boundaries), for one entity. Each
 * snapshot is the journal folded up to that boundary — so the series is a true point-in-time history.
 */
export function snapshotsAtBoundaries(
  entity: string,
  id: string,
  entries: readonly HistoryEntry[],
  boundaries: readonly string[],
  base: Record<string, unknown> = {},
): EntitySnapshot[] {
  return boundaries.map((asOf) => materialiseSnapshot(entity, id, entries, asOf, base));
}
