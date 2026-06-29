import type { Project, PortfolioHealthSummary } from "@workspace/api-client-react";
import { triggerBlobDownload } from "./setup";
import { markExplorationDirty, markExplorationClean } from "./exploration";

/**
 * Portfolio snapshots — point-in-time captures of the live read-model, taken in
 * the BROWSER so OmniProject stays stateless and zero-data-at-rest. Captures are
 * held in sessionStorage (volatile; cleared on tab close) and can be exported to
 * a JSON file on the user's disk for durable, cross-session, multi-point trends.
 * The gateway never sees a snapshot — there is no broker call and no contract
 * change. A trend is derived purely client-side from N captured points, badged
 * `captured` so it is never mistaken for backend-recorded history.
 */

export const SNAPSHOT_SCHEMA = 1;
const STORAGE_KEY = "omniproject-portfolio-snapshots";

/** Only the fields needed to trend a portfolio, trimmed from the live read-model. */
export interface SnapshotProject {
  id: string;
  name: string;
  issueCount: number;
  completedCount: number;
}
export interface SnapshotPortfolioRow {
  projectId: string;
  ragStatus: string;
  scheduleVarianceDays: number;
  budgetVariancePercentage: number;
  activeBlockersCount: number;
}

export interface PortfolioSnapshot {
  schema: number;
  id: string;
  capturedAt: string; // ISO 8601
  label?: string;
  /** capabilities.mode at capture time ("demo" ⇒ the points are sample data). */
  mode?: string;
  projects: SnapshotProject[];
  portfolio: SnapshotPortfolioRow[];
}

/** A bundle is just an array of snapshots — the export/import wire shape. */
export interface SnapshotBundle {
  schema: number;
  exportedAt: string;
  snapshots: PortfolioSnapshot[];
}

// ── Construction (pure) ──────────────────────────────────────────────────────

/**
 * Build a snapshot from the current live data. `capturedAt` is injectable for
 * deterministic tests; it defaults to now.
 */
export function createSnapshot(
  input: { projects?: Project[]; portfolio?: PortfolioHealthSummary[]; mode?: string; label?: string },
  capturedAt: string = new Date().toISOString(),
): PortfolioSnapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    id: `snap-${capturedAt}-${Math.round((input.projects?.length ?? 0))}-${(input.portfolio?.length ?? 0)}`,
    capturedAt,
    label: input.label?.trim() || undefined,
    mode: input.mode,
    projects: (input.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      issueCount: p.issueCount ?? 0,
      completedCount: p.completedCount ?? 0,
    })),
    portfolio: (input.portfolio ?? []).map((r) => ({
      projectId: r.projectId,
      ragStatus: r.ragStatus,
      scheduleVarianceDays: r.scheduleVarianceDays ?? 0,
      budgetVariancePercentage: r.budgetVariancePercentage ?? 0,
      activeBlockersCount: r.activeBlockersCount ?? 0,
    })),
  };
}

// ── Validation (pure) ────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Returns the snapshot if `obj` is structurally a valid snapshot, else null. */
export function validateSnapshot(obj: unknown): PortfolioSnapshot | null {
  if (!isRecord(obj)) return null;
  if (typeof obj["capturedAt"] !== "string" || Number.isNaN(Date.parse(obj["capturedAt"] as string))) return null;
  if (!Array.isArray(obj["projects"]) || !Array.isArray(obj["portfolio"])) return null;
  // Coerce defensively — an imported file is user-controlled.
  const snap = obj as unknown as PortfolioSnapshot;
  return {
    schema: typeof snap.schema === "number" ? snap.schema : SNAPSHOT_SCHEMA,
    id: typeof snap.id === "string" && snap.id ? snap.id : `snap-${snap.capturedAt}`,
    capturedAt: snap.capturedAt,
    label: typeof snap.label === "string" ? snap.label : undefined,
    mode: typeof snap.mode === "string" ? snap.mode : undefined,
    projects: snap.projects.filter(isRecord).map((p) => ({
      id: String((p as SnapshotProject).id ?? ""),
      name: String((p as SnapshotProject).name ?? ""),
      issueCount: Number((p as SnapshotProject).issueCount ?? 0),
      completedCount: Number((p as SnapshotProject).completedCount ?? 0),
    })),
    portfolio: snap.portfolio.filter(isRecord).map((r) => ({
      projectId: String((r as SnapshotPortfolioRow).projectId ?? ""),
      ragStatus: String((r as SnapshotPortfolioRow).ragStatus ?? ""),
      scheduleVarianceDays: Number((r as SnapshotPortfolioRow).scheduleVarianceDays ?? 0),
      budgetVariancePercentage: Number((r as SnapshotPortfolioRow).budgetVariancePercentage ?? 0),
      activeBlockersCount: Number((r as SnapshotPortfolioRow).activeBlockersCount ?? 0),
    })),
  };
}

/** Parse an imported file (single snapshot OR a {snapshots:[…]} bundle). */
export function parseSnapshotFile(text: string): PortfolioSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const asBundle = parsed as unknown as SnapshotBundle;
  const raw: unknown[] = isRecord(parsed) && Array.isArray(asBundle.snapshots) ? asBundle.snapshots : [parsed];
  return raw.map(validateSnapshot).filter((s): s is PortfolioSnapshot => s !== null);
}

// ── Session persistence (volatile) ───────────────────────────────────────────

export function loadSnapshots(): PortfolioSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(validateSnapshot).filter((s): s is PortfolioSnapshot => s !== null) : [];
  } catch {
    return [];
  }
}

export function saveSnapshots(list: PortfolioSnapshot[]): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** Append (de-duped by id), keep sorted by capturedAt, persist, and return the list. */
export function addSnapshots(existing: PortfolioSnapshot[], incoming: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  const merged = [...byId.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  saveSnapshots(merged);
  markExplorationDirty(); // new captured work — download to keep, else lost at session end
  return merged;
}

export function removeSnapshot(existing: PortfolioSnapshot[], id: string): PortfolioSnapshot[] {
  const next = existing.filter((s) => s.id !== id);
  saveSnapshots(next);
  return next;
}

// ── Export (file on the user's disk — durable, not in the gateway) ───────────

export function buildBundle(snapshots: PortfolioSnapshot[], exportedAt: string = new Date().toISOString()): SnapshotBundle {
  return { schema: SNAPSHOT_SCHEMA, exportedAt, snapshots };
}

export function exportSnapshots(snapshots: PortfolioSnapshot[]): void {
  const bundle = buildBundle(snapshots);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  triggerBlobDownload(blob, `omniproject-trends-${bundle.exportedAt.slice(0, 10)}.json`);
  markExplorationClean(); // a copy is now on the user's disk
}

// ── Auto-capture schedule (client-side, volatile) ────────────────────────────
// A schedule captures on an interval until an end date/time. It runs ONLY while
// the tab is open (it's a browser timer, not a server cron) and the config is
// held in sessionStorage so a refresh resumes it within the same session. For
// durable overnight cadence you'd use the broker snapshot-historian (Tier B).

const SCHEDULE_KEY = "omniproject-snapshot-schedule";

export interface AutoSchedule {
  intervalMinutes: number;
  endsAt: string; // ISO 8601 — capturing stops at/after this instant
  startedAt: string;
}

export function loadSchedule(): AutoSchedule | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SCHEDULE_KEY);
    const s = raw ? (JSON.parse(raw) as AutoSchedule) : null;
    return s && typeof s.intervalMinutes === "number" && typeof s.endsAt === "string" ? s : null;
  } catch {
    return null;
  }
}

export function saveSchedule(s: AutoSchedule | null): void {
  if (typeof window === "undefined") return;
  if (s) window.sessionStorage.setItem(SCHEDULE_KEY, JSON.stringify(s));
  else window.sessionStorage.removeItem(SCHEDULE_KEY);
}

/** True while now is before the schedule's end and the interval is valid. */
export function scheduleActive(s: AutoSchedule | null, nowMs: number): boolean {
  if (!s || s.intervalMinutes <= 0) return false;
  return nowMs < Date.parse(s.endsAt);
}

/** True when a capture is due (no prior capture, or one interval has elapsed). */
export function captureDue(s: AutoSchedule, lastCaptureMs: number | null, nowMs: number): boolean {
  if (!scheduleActive(s, nowMs)) return false;
  if (lastCaptureMs === null) return true;
  return nowMs - lastCaptureMs >= s.intervalMinutes * 60_000;
}

// ── Trend derivation (pure) ──────────────────────────────────────────────────

export type TrendMetric = "completion" | "schedule" | "budget" | "blockers" | "ragRed";

export const TREND_METRICS: { key: TrendMetric; label: string; unit: string }[] = [
  { key: "completion", label: "Completion", unit: "%" },
  { key: "schedule", label: "Avg schedule variance", unit: "d" },
  { key: "budget", label: "Avg budget variance", unit: "%" },
  { key: "blockers", label: "Active blockers", unit: "" },
  { key: "ragRed", label: "Projects at RED", unit: "" },
];

const avg = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

/** Portfolio completion % = Σ completed / Σ issues. */
export function portfolioCompletion(snap: PortfolioSnapshot): number {
  const total = snap.projects.reduce((s, p) => s + p.issueCount, 0);
  const done = snap.projects.reduce((s, p) => s + p.completedCount, 0);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function metricValue(snap: PortfolioSnapshot, metric: TrendMetric): number {
  switch (metric) {
    case "completion":
      return portfolioCompletion(snap);
    case "schedule":
      return Math.round(avg(snap.portfolio.map((r) => r.scheduleVarianceDays)));
    case "budget":
      return Math.round(avg(snap.portfolio.map((r) => r.budgetVariancePercentage)));
    case "blockers":
      return snap.portfolio.reduce((s, r) => s + r.activeBlockersCount, 0);
    case "ragRed":
      return snap.portfolio.filter((r) => r.ragStatus.toUpperCase() === "RED").length;
    default:
      return 0;
  }
}

export interface TrendPoint {
  date: string; // short label
  capturedAt: string;
  value: number;
}

/** A time-ordered series for one metric across the captured snapshots. */
export function buildTrend(snapshots: PortfolioSnapshot[], metric: TrendMetric): TrendPoint[] {
  return [...snapshots]
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((s) => ({
      capturedAt: s.capturedAt,
      date: s.label || new Date(s.capturedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: metricValue(s, metric),
    }));
}
