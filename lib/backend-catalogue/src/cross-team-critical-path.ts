/**
 * CROSS-TEAM CRITICAL PATH — the scaled-agile lens on the critical path (roadmap §4.5, "dependency graph +
 * critical-path across teams"). The single-project critical path answers "which activities can't slip?";
 * across an ART / multiple teams the sharper question is "where does the critical path HAND OFF between teams?"
 * — those hand-offs are where PI plans break, and they're exactly what a program board needs flagged.
 *
 * This does NOT re-implement CPM: it calls the existing {@link criticalPath} solver, then annotates the path it
 * returns with each activity's team and surfaces the cross-team structure — the ordered hand-off edges (a
 * critical activity on team A immediately followed by one on team B), the teams on the path, and each team's
 * share of the critical-path duration. The new compute is the team-boundary analysis; the scheduling stays in
 * one place so the two can't disagree.
 *
 * Pure, no I/O. Deterministic (path order preserved, teams/breakdown sorted by a fixed key; no Math.random).
 * Validation first: an unknown/absent team maps to a stable `"unassigned"` label; durations come from the CPM
 * inputs. Every divide guarded — a zero project duration leaves each team's `durationPct` `null`, never NaN;
 * empty input ⇒ empty path, no hand-offs.
 */
import { criticalPath, type CpmNode, type CpmEdge } from "./critical-path";

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The team a node is assigned to; absent ⇒ "unassigned". */
export type TeamByNode = Record<string, string>;

export interface CriticalActivity {
  id: string;
  team: string;
  duration: number;
}

/** A point on the critical path where work passes from one team to another. */
export interface Handoff {
  fromId: string;
  toId: string;
  fromTeam: string;
  toTeam: string;
}

export interface TeamShare {
  team: string;
  /** Number of critical activities owned by this team. */
  activities: number;
  /** Summed duration of this team's critical activities. */
  duration: number;
  /** duration / projectDuration; `null` when the project duration is 0. */
  durationPct: number | null;
}

export interface CrossTeamCriticalPathResult {
  /** The critical path (topological order), each activity annotated with its team + duration. */
  criticalPath: CriticalActivity[];
  /** Cross-team hand-offs along the critical path, in path order. */
  handoffs: Handoff[];
  handoffCount: number;
  /** Distinct teams appearing on the critical path, sorted. */
  teamsOnPath: string[];
  projectDuration: number;
  /** Per-team share of the critical path, most duration first (team-name tiebreak). */
  byTeam: TeamShare[];
  /** Passed through from the CPM solve — a cycle leaves the schedule (and path) degraded. */
  hasCycle: boolean;
}

const UNASSIGNED = "unassigned";

/**
 * Solve the critical path, then analyse its cross-team structure. `teamByNode` maps activity id → team; any id
 * not present is treated as `"unassigned"`. Empty nodes ⇒ an empty path with no hand-offs.
 */
export function analyzeCrossTeamCriticalPath(
  nodes: readonly CpmNode[],
  edges: readonly CpmEdge[],
  teamByNode: TeamByNode = {},
): CrossTeamCriticalPathResult {
  const cpm = criticalPath(nodes, edges);
  const durationById = new Map(nodes.map((n) => [n.id, Math.max(0, n.duration)]));
  const teamOf = (id: string): string => {
    const t = teamByNode[id];
    return typeof t === "string" && t.length > 0 ? t : UNASSIGNED;
  };

  const path: CriticalActivity[] = cpm.criticalPath.map((id) => ({
    id,
    team: teamOf(id),
    duration: durationById.get(id) ?? 0,
  }));

  const handoffs: Handoff[] = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!, cur = path[i]!;
    if (prev.team !== cur.team) {
      handoffs.push({ fromId: prev.id, toId: cur.id, fromTeam: prev.team, toTeam: cur.team });
    }
  }

  // Per-team duration + activity tallies along the critical path.
  const tally = new Map<string, { activities: number; duration: number }>();
  for (const a of path) {
    const t = tally.get(a.team) ?? { activities: 0, duration: 0 };
    t.activities++; t.duration += a.duration;
    tally.set(a.team, t);
  }
  const projectDuration = cpm.projectDuration;
  const byTeam: TeamShare[] = [...tally.entries()]
    .map(([team, t]) => ({
      team,
      activities: t.activities,
      duration: t.duration,
      durationPct: projectDuration === 0 ? null : round4(t.duration / projectDuration),
    }))
    .sort((a, b) => (b.duration !== a.duration ? b.duration - a.duration : byStr(a.team, b.team)));

  return {
    criticalPath: path,
    handoffs,
    handoffCount: handoffs.length,
    teamsOnPath: [...tally.keys()].sort(byStr),
    projectDuration,
    byTeam,
    hasCycle: cpm.hasCycle,
  };
}
