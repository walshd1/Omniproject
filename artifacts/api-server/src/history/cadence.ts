/**
 * Snapshot cadence — HOW OFTEN the retention source materialises a snapshot, resolved across the
 * org → programme → project hierarchy. Operator-confirmed model:
 *   - **variable cadence**, not a fixed daily job;
 *   - **gated by admin (org default) + PMO (programme/project overrides)** — most-specific scope wins;
 *   - **infinite retention** — cadence governs write frequency only; snapshots are never pruned.
 *
 * A baseline capture always forces a snapshot regardless of cadence (a baseline is a point you must be
 * able to return to), so `manual` still yields the on-baseline points a variance trend needs.
 */

/** How often to materialise a snapshot. */
export type SnapshotCadence =
  | { kind: "onWrite" } // a snapshot at every transaction boundary (highest fidelity)
  | { kind: "interval"; everyHours: number } // a snapshot at a fixed cadence (e.g. 24 = daily)
  | { kind: "manual" }; // only on baseline/explicit capture — no automatic snapshots

/** The org default cadence plus per-scope (PMO) overrides. Infinite retention is implicit. */
export interface HistoryRetentionConfig {
  /** Admin: the org-wide default cadence. */
  orgDefault: SnapshotCadence;
  /** PMO: per-programme overrides, keyed by programmeId. */
  programme: Record<string, SnapshotCadence>;
  /** PMO/PM: per-project overrides, keyed by projectId. */
  project: Record<string, SnapshotCadence>;
}

export interface CadenceScope {
  programmeId?: string | null;
  projectId?: string | null;
}

/** The default when nothing is configured: daily (a sensible, low-cost starting cadence). */
export const DEFAULT_CADENCE: SnapshotCadence = { kind: "interval", everyHours: 24 };

export const DEFAULT_RETENTION_CONFIG: HistoryRetentionConfig = {
  orgDefault: DEFAULT_CADENCE,
  programme: {},
  project: {},
};

/** Structural validity of a cadence value (used by settings validation on untrusted input). */
export function isValidCadence(value: unknown): value is SnapshotCadence {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c["kind"] === "onWrite" || c["kind"] === "manual") return true;
  if (c["kind"] === "interval") {
    const h = c["everyHours"];
    return typeof h === "number" && Number.isFinite(h) && h > 0 && h <= 24 * 366;
  }
  return false;
}

/**
 * Resolve the effective cadence for a scope: project override ▸ programme override ▸ org default.
 * Most-specific scope wins — the PMO's programme/project overrides trump the admin's org default for
 * that scope, exactly like the feature-governance hierarchy.
 */
export function resolveCadence(config: HistoryRetentionConfig, scope: CadenceScope = {}): SnapshotCadence {
  if (scope.projectId && config.project[scope.projectId]) return config.project[scope.projectId]!;
  if (scope.programmeId && config.programme[scope.programmeId]) return config.programme[scope.programmeId]!;
  return config.orgDefault;
}

/**
 * Is a fresh snapshot due, given the last snapshot's time and `now`?
 *   - `onWrite`  ⇒ always (the caller invokes this on a transaction boundary);
 *   - `manual`   ⇒ never automatically (baseline capture forces one out-of-band);
 *   - `interval` ⇒ when at least `everyHours` have elapsed (or there's no prior snapshot).
 */
export function dueForSnapshot(lastSnapshotAt: string | null, cadence: SnapshotCadence, now: string): boolean {
  switch (cadence.kind) {
    case "onWrite":
      return true;
    case "manual":
      return false;
    case "interval": {
      if (!lastSnapshotAt) return true;
      const elapsedMs = Date.parse(now) - Date.parse(lastSnapshotAt);
      return elapsedMs >= cadence.everyHours * 3_600_000;
    }
  }
}
