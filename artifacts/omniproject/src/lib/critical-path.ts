/**
 * Critical Path Method (CPM) — a pure, STATELESS solver.
 *
 * Given activities with durations and precedence edges (`from` must finish before `to`
 * starts), it runs the standard forward/backward pass to compute each activity's earliest
 * and latest start/finish, its total float, and which activities lie on the critical path
 * (zero float). Nothing is stored: the durations come from the live read model and the
 * edges from the existing (volatile/exportable) dependency overlay, so the same inputs
 * always yield the same schedule. Cycles are detected and reported rather than hung on.
 */

export interface CpmNode {
  id: string;
  /** Activity duration in whatever unit the caller uses (clamped to ≥ 0). */
  duration: number;
}

/** Precedence: `from` must finish before `to` can start. */
export interface CpmEdge {
  from: string;
  to: string;
}

export interface CpmNodeResult {
  id: string;
  duration: number;
  /** Earliest start / finish. */
  es: number;
  ef: number;
  /** Latest start / finish. */
  ls: number;
  lf: number;
  /** Total float (slack) = ls − es. Zero ⇒ on the critical path. */
  float: number;
  critical: boolean;
}

export interface CpmResult {
  nodes: Record<string, CpmNodeResult>;
  /** Topological order of the scheduled (acyclic) activities. */
  order: string[];
  /** Total project duration (max earliest finish). */
  projectDuration: number;
  /** Critical activities in topological order. */
  criticalPath: string[];
  /** True when a dependency cycle was found (those activities are left unscheduled). */
  hasCycle: boolean;
  /** Activity ids that could not be scheduled because they sit in/after a cycle. */
  unscheduled: string[];
}

// Floats below this are treated as zero (durations are integers in practice, but keep it safe).
const EPS = 1e-9;

/**
 * Solve the CPM schedule. Edges referencing unknown nodes are ignored; durations are
 * clamped to ≥ 0. If the precedence graph contains a cycle, the activities that can't be
 * ordered are returned in `unscheduled` and `hasCycle` is true (the rest still schedule).
 */
export function criticalPath(nodes: readonly CpmNode[], edges: readonly CpmEdge[]): CpmResult {
  const duration = new Map<string, number>();
  for (const n of nodes) duration.set(n.id, Math.max(0, n.duration));

  // Adjacency + in-degree over edges whose endpoints both exist (dedup repeats).
  const succ = new Map<string, Set<string>>();
  const pred = new Map<string, Set<string>>();
  for (const id of duration.keys()) {
    succ.set(id, new Set());
    pred.set(id, new Set());
  }
  for (const e of edges) {
    if (!duration.has(e.from) || !duration.has(e.to) || e.from === e.to) continue;
    succ.get(e.from)!.add(e.to);
    pred.get(e.to)!.add(e.from);
  }

  // Kahn topological sort.
  const indeg = new Map<string, number>();
  for (const id of duration.keys()) indeg.set(id, pred.get(id)!.size);
  const queue = [...duration.keys()].filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const hasCycle = order.length < duration.size;
  const scheduled = new Set(order);
  const unscheduled = [...duration.keys()].filter((id) => !scheduled.has(id));

  // Forward pass: ES = max EF of predecessors; EF = ES + duration.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    for (const p of pred.get(id)!) {
      if (scheduled.has(p)) start = Math.max(start, ef.get(p)!);
    }
    es.set(id, start);
    ef.set(id, start + duration.get(id)!);
  }
  const projectDuration = order.reduce((m, id) => Math.max(m, ef.get(id)!), 0);

  // Backward pass (reverse topo): LF = min LS of successors, else project end; LS = LF − duration.
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    let finish = projectDuration;
    for (const s of succ.get(id)!) {
      if (scheduled.has(s)) finish = Math.min(finish, ls.get(s)!);
    }
    lf.set(id, finish);
    ls.set(id, finish - duration.get(id)!);
  }

  const result: Record<string, CpmNodeResult> = {};
  const criticalPathIds: string[] = [];
  for (const id of order) {
    const slack = ls.get(id)! - es.get(id)!;
    const critical = Math.abs(slack) <= EPS;
    result[id] = {
      id,
      duration: duration.get(id)!,
      es: es.get(id)!,
      ef: ef.get(id)!,
      ls: ls.get(id)!,
      lf: lf.get(id)!,
      float: slack,
      critical,
    };
    if (critical) criticalPathIds.push(id);
  }

  return { nodes: result, order, projectDuration, criticalPath: criticalPathIds, hasCycle, unscheduled };
}
