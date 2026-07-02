/**
 * Portfolio roadmap — a pure, STATELESS derivation of a cross-programme timeline.
 *
 * A Project carries no schedule of its own, so we infer each project's span from the
 * dates already on its work items (earliest start … latest due), then group projects
 * into programme swimlanes. Nothing is persisted: given the same read model in, the
 * same roadmap comes out. All maths is in epoch-ms so it stays timezone-agnostic and
 * trivially testable.
 */

export interface RoadmapIssue {
  startDate?: string | null;
  dueDate?: string | null;
}

export interface RoadmapProject {
  id: string;
  /** The backend the project was read through. Used to qualify the identity key so two
   *  projects that share a bare `id` across different sources never collide. */
  source?: string | null | undefined;
  name: string;
  programmeId?: string | null | undefined;
  programmeName?: string | null | undefined;
  issueCount: number;
  completedCount: number;
}

/**
 * The key under which a project's issues are looked up — the composite `source:id`, so two
 * projects that happen to share a bare `id` across different backends never read each other's
 * issues. Callers MUST build `issuesByProject` with this same helper. Falls back to the bare
 * `id` when no source is present (single-source data stays unchanged).
 */
export function roadmapKey(project: Pick<RoadmapProject, "id" | "source">): string {
  const s = typeof project.source === "string" ? project.source.trim() : "";
  return s ? `${s}:${project.id}` : project.id;
}

export interface Span {
  /** epoch ms */
  start: number;
  /** epoch ms */
  end: number;
}

export interface RoadmapBar extends Span {
  projectId: string;
  projectName: string;
  /** 0..1 share of the project's issues that are complete. */
  completionRate: number;
}

export interface RoadmapLane extends Span {
  /** programmeId, or the standalone sentinel. */
  key: string;
  name: string;
  bars: RoadmapBar[];
}

export interface Roadmap {
  lanes: RoadmapLane[];
  /** Overall axis bounds (epoch ms) across every dated project. */
  min: number;
  max: number;
  /** Projects that yielded a datable span (rendered as bars). */
  datedProjects: number;
  /** Total projects considered (so the UI can report what was excluded). */
  totalProjects: number;
}

/** Projects with no programme are gathered under one lane, always rendered last. */
export const STANDALONE_KEY = "__standalone__";
export const STANDALONE_NAME = "Standalone projects";

/** Strict ISO/date parse → epoch ms, or null when unparseable. */
export function parseDate(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Infer a project's span from its issues: the earliest and latest of every date present
 * (a start or a due both count as evidence the work touches that point in time). Returns
 * null when no issue carries a usable date — such a project can't be placed on a timeline.
 */
export function deriveSpan(issues: readonly RoadmapIssue[]): Span | null {
  let start = Infinity;
  let end = -Infinity;
  for (const issue of issues) {
    for (const ms of [parseDate(issue.startDate), parseDate(issue.dueDate)]) {
      if (ms === null) continue;
      if (ms < start) start = ms;
      if (ms > end) end = ms;
    }
  }
  if (start === Infinity) return null;
  return { start, end };
}

/** completed / total, clamped to [0,1]; 0 when there are no issues. */
function completionRate(p: RoadmapProject): number {
  // Counts come from the untrusted read model — coerce so a string/null/NaN issueCount can't
  // produce a NaN completion bar (which would break the rendered fill width).
  const total = typeof p.issueCount === "number" && Number.isFinite(p.issueCount) ? p.issueCount : Number(p.issueCount);
  const done = typeof p.completedCount === "number" && Number.isFinite(p.completedCount) ? p.completedCount : Number(p.completedCount);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const d = Number.isFinite(done) ? done : 0;
  return Math.min(1, Math.max(0, d / total));
}

/**
 * Build the grouped roadmap. `issuesByProject` maps a project id to the issues already
 * loaded for it; a project absent from the map (or with no dated issues) is counted but
 * not placed. Lanes are ordered by their earliest bar, with the standalone lane last.
 */
export function buildRoadmap(
  projects: readonly RoadmapProject[],
  issuesByProject: Readonly<Record<string, readonly RoadmapIssue[]>>,
): Roadmap {
  const laneMap = new Map<string, RoadmapLane>();
  let min = Infinity;
  let max = -Infinity;
  let datedProjects = 0;

  for (const project of projects) {
    // Look up by the composite key so same-id/different-source projects never share issues.
    const span = deriveSpan(issuesByProject[roadmapKey(project)] ?? []);
    if (!span) continue;
    datedProjects += 1;
    if (span.start < min) min = span.start;
    if (span.end > max) max = span.end;

    const key = project.programmeId ?? STANDALONE_KEY;
    const name = project.programmeId
      ? project.programmeName || "Programme"
      : STANDALONE_NAME;
    let lane = laneMap.get(key);
    if (!lane) {
      lane = { key, name, bars: [], start: Infinity, end: -Infinity };
      laneMap.set(key, lane);
    }
    lane.bars.push({
      projectId: project.id,
      projectName: project.name,
      start: span.start,
      end: span.end,
      completionRate: completionRate(project),
    });
    if (span.start < lane.start) lane.start = span.start;
    if (span.end > lane.end) lane.end = span.end;
  }

  const lanes = [...laneMap.values()];
  // Stable final tiebreaker on projectId so bars with identical spans have a deterministic order.
  for (const lane of lanes) lane.bars.sort((a, b) => a.start - b.start || a.end - b.end || a.projectId.localeCompare(b.projectId));
  lanes.sort((a, b) => {
    // Standalone always sinks to the bottom; otherwise earliest-starting lane first.
    if (a.key === STANDALONE_KEY) return 1;
    if (b.key === STANDALONE_KEY) return -1;
    // key (the programmeId) is unique per lane, so it breaks name/start ties deterministically.
    return a.start - b.start || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });

  return {
    lanes,
    min: datedProjects ? min : 0,
    max: datedProjects ? max : 0,
    datedProjects,
    totalProjects: projects.length,
  };
}

/** Position a date as a 0–100% offset along the [min,max] axis (clamped; 0 when degenerate). */
export function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const p = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, p));
}
