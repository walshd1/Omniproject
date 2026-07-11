/**
 * History-retention vocabulary — the durable time-series layer that lets the self-host DB (or any
 * retention source) answer "what did this look like on that date" and "how has this metric moved".
 *
 * It sits BELOW the composition seam in spirit: the gateway holds nothing, the retention SOURCE holds
 * the journal + snapshots. Everything in this package is pure (no settings/express/SQL) so the whole
 * retention path is unit-testable and runs identically wherever it's called. Provenance re-uses OUR
 * existing lineage enum (broker `HistoryState.provenance`): a recorded historical state is `replayed`.
 *
 * Design decisions (operator-confirmed): **infinite snapshot retention** (snapshots are never pruned)
 * and a **variable cadence gated by admin (org) + PMO (programme/project)** — see cadence.ts.
 */

/** OUR lineage enum — must match the literals across broker/types.ts + composition/types. */
export type Provenance = "sourced" | "derived" | "sample" | "replayed" | "projected";

/**
 * One append-only change-journal row: a single field's transition at a point in time. The journal is
 * the raw truth (never overwritten); snapshots are derived from it. `null` old value = first-seen.
 */
export interface HistoryEntry {
  entity: string;
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: string; // ISO 8601
  changedBy: string | null;
  /** Groups the field changes made by one write, so a snapshot boundary is a whole transaction. */
  txnId: string;
}

/** A materialised point-in-time state of one entity — the fold of the journal up to `asOf`. */
export interface EntitySnapshot {
  entity: string;
  id: string;
  asOf: string; // ISO 8601
  values: Record<string, unknown>;
  provenance: Provenance;
}

/** The bucket grain a trend series is aggregated at. */
export type TrendGrain = "day" | "week" | "month" | "quarter";

/**
 * A metric a trend series can chart. Each maps to an extractor over an EntitySnapshot's values (or a
 * derivation across the journal, for flow metrics). Names mirror the canonical field/report vocabulary.
 */
export type TrendMetric =
  | "completionPct"
  | "openBlockers"
  | "cpi" // cost performance index (EVM)
  | "spi" // schedule performance index (EVM)
  | "estimateAtCompletion"
  | "costVariance"
  | "scheduleVariance"
  | "benefitRealisedPct"
  | "openRisks"
  | "cycleTimeDays" // flow: mean time from start→done for items completing in the bucket
  | "throughput"; // flow: count of items completing in the bucket

/** One point on a trend series: the bucket's timestamp + the aggregated value (null = no data). */
export interface TrendPoint {
  at: string; // ISO 8601 — the bucket's start
  value: number | null;
  /** How many entities/observations rolled into this bucket (0 ⇒ value is null). */
  n: number;
  provenance: Provenance;
}

/** A full trend series for one metric over a window at a grain. */
export interface TrendSeries {
  metric: TrendMetric;
  grain: TrendGrain;
  from: string;
  to: string;
  points: TrendPoint[];
  /** False when no retention source is available (the honest "history not yet retained" answer). */
  available: boolean;
  /** Present when unavailable — why (e.g. "history domain not enabled", "no retention source"). */
  reason?: string;
}

/** A half-open time window [from, to). */
export interface TimeWindow {
  from: string;
  to: string;
}
