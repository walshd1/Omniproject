/**
 * The retention SOURCE seam — the one abstraction the gateway drives for durable history. It holds
 * nothing itself; a concrete source (the self-host DB below the seam, via the broker's parameterised
 * SQL) owns the journal + snapshots. The gateway registers a *provider* (scope → source | null); when
 * no source is configured the trend API answers honestly ("history not yet retained") rather than
 * inventing data. This keeps the gateway zero-at-rest while making the common retention path real and
 * injectable: tests supply an in-memory source, production supplies the self-host source.
 */
import type { EntitySnapshot, HistoryEntry, TimeWindow, TrendGrain, TrendMetric, TrendSeries } from "./types";
import { computeSeries, unavailableSeries } from "./trends";
import { diffToJournal, type WriteMeta } from "./journal";
import { materialiseSnapshot } from "./snapshot";
import { dueForSnapshot, type SnapshotCadence } from "./cadence";

/** A durable history store for one deployment. Every method is async — the real one talks to a DB. */
export interface RetentionSource {
  /** Snapshots for the given entity ids within a window (inclusive of the as-of boundary reads). */
  readSnapshots(entity: string, ids: readonly string[], window: TimeWindow): Promise<EntitySnapshot[]>;
  /** The raw journal for one entity within a window (for flow metrics / audit). */
  readJournal(entity: string, id: string, window: TimeWindow): Promise<HistoryEntry[]>;
  /** Append change-journal rows (idempotent on txnId + field). */
  appendJournal(entries: readonly HistoryEntry[]): Promise<void>;
  /** Persist a materialised snapshot (infinite retention — never pruned). */
  writeSnapshot(snapshot: EntitySnapshot): Promise<void>;
  /** The most recent snapshot time for an entity, or null if none — drives the cadence check. */
  lastSnapshotAt(entity: string, id: string): Promise<string | null>;
  /**
   * DISPOSAL (storage-limitation): delete snapshots + journal rows OLDER than `cutoffIso`, EXCEPT any
   * `entity#id` present in `heldKeys` (legal hold). Optional — a source that can't dispose omits it and
   * the gateway reports disposal as unsupported. Returns the row counts deleted.
   */
  disposeOlderThan?(cutoffIso: string, opts?: { heldKeys?: readonly string[] }): Promise<DisposalResult>;
  /**
   * ERASURE (right-to-erasure / DSAR): delete ALL history (snapshots + journal) for one entity id.
   * Optional. The gateway refuses to call this when the key is under legal hold (checked before dispatch).
   */
  eraseEntity?(entity: string, id: string): Promise<DisposalResult>;
}

/** Rows deleted by a disposal / erasure operation. */
export interface DisposalResult {
  snapshots: number;
  journal: number;
}

export interface RetentionScope {
  programmeId?: string | null;
  projectId?: string | null;
}

/** Resolve a retention source for a scope, or null when none is configured for this deployment. */
export type RetentionProvider = (scope: RetentionScope) => RetentionSource | null;

let provider: RetentionProvider = () => null;

/** Register the deployment's retention provider (the self-host source, in production). */
export function registerRetentionProvider(p: RetentionProvider): void {
  provider = p;
}

/** Reset to the default (no source) — used by tests to isolate. */
export function resetRetentionProvider(): void {
  provider = () => null;
}

/** The source for a scope, or null. */
export function retentionSourceFor(scope: RetentionScope = {}): RetentionSource | null {
  return provider(scope);
}

/**
 * Build a trend series for a scope: resolve the source, read its snapshots, compute the series. When
 * no source is configured (or `reasonWhenNone` is supplied because the domain is gated off), return an
 * honest unavailable series so the UI can say "history not yet retained" instead of showing zeroes.
 */
export async function buildTrend(
  entity: string,
  ids: readonly string[],
  metric: TrendMetric,
  window: TimeWindow,
  grain: TrendGrain,
  scope: RetentionScope = {},
  reasonWhenNone = "no retention source configured",
): Promise<TrendSeries> {
  const source = retentionSourceFor(scope);
  if (!source) return unavailableSeries(metric, grain, window, reasonWhenNone);
  const snapshots = await source.readSnapshots(entity, ids, window);
  return computeSeries(snapshots, metric, window, grain);
}

/**
 * The write-path glue: on a write, append the field diffs to the journal and — if the cadence says a
 * snapshot is due — materialise + persist one. Pure orchestration over the injected source; the
 * caller supplies `prev`/`next`/`meta`/`cadence`, so this is deterministic and testable.
 */
export async function recordWrite(
  source: RetentionSource,
  entity: string,
  id: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  meta: WriteMeta,
  cadence: SnapshotCadence,
): Promise<{ journalled: number; snapshotted: boolean }> {
  const entries = diffToJournal(entity, id, prev, next, meta);
  if (entries.length === 0) return { journalled: 0, snapshotted: false };
  await source.appendJournal(entries);
  const last = await source.lastSnapshotAt(entity, id);
  if (!dueForSnapshot(last, cadence, meta.changedAt)) return { journalled: entries.length, snapshotted: false };
  const merged = { ...prev, ...next };
  await source.writeSnapshot(materialiseSnapshot(entity, id, [], meta.changedAt, merged, "replayed"));
  return { journalled: entries.length, snapshotted: true };
}
