/**
 * TASK DEPENDENCY GRAPH — a pure, STATELESS solver for GTD next-action blocking dependencies (task-management
 * assessment gap T1). Given a set of tasks and "blocked-by" edges, it classifies each open task as READY
 * (no open blocker) or BLOCKED (waiting on an unfinished blocker), detects deadlock cycles, produces the
 * topological "ready-now" work order, and finds the longest blocking chain (the task-level critical chain
 * that gates completion). Peer task managers (Asana / ClickUp / Linear) all have task dependencies; the
 * platform had them only for issues (`broker/types.ts` dependency mapping), never for GTD tasks.
 *
 * Mirrors `critical-path.ts` — the same Kahn topological sort + cycle detection + edge-hygiene (unknown /
 * self edges ignored) — but over blocking semantics rather than schedule float, and reuses
 * `isTaskStatusClosed` so a DONE or DROPPED blocker counts as satisfied (a closed task never blocks). Pure,
 * deterministic (no `Date`, no `Math.random`, id-tiebroken ordering), fail-closed on malformed input (ids
 * coerced to strings; non-object entries dropped; never throws), empty ⇒ empty. Lives below the broker seam
 * so every surface (API, SPA, report engine) shares one implementation.
 */
import { isTaskStatusClosed } from "./task-vocabulary";

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface DependencyTask {
  id: string;
  /** GTD task status; a `done`/`dropped` status ⇒ the task is closed and never blocks. */
  status?: string | null;
}

/** A blocking edge: `taskId` is blocked by `blockedBy` (blockedBy must be closed before taskId is ready). */
export interface TaskDependencyEdge {
  taskId: string;
  blockedBy: string;
}

/** ready = actionable now; blocked = waiting on ≥1 open blocker (or in a cycle); closed = done/dropped. */
export type TaskReadiness = "ready" | "blocked" | "closed";

export interface TaskDependencyNode {
  id: string;
  status: string | null;
  closed: boolean;
  readiness: TaskReadiness;
  /** Open (unfinished, existing) blockers of this task, id-sorted. */
  blockedBy: string[];
  /** Open tasks this task blocks, id-sorted. */
  blocks: string[];
  /** True when this task sits in — or downstream of — a dependency cycle (can never become ready). */
  inCycle: boolean;
  /** Longest chain of open blockers behind this task (0 ⇒ no open blockers ⇒ ready). */
  depth: number;
}

export interface TaskDependencyResult {
  nodes: Record<string, TaskDependencyNode>;
  /** Open, non-cyclic tasks with no open blocker — the actionable set, id-sorted. */
  readyNow: string[];
  /** Open tasks with ≥1 open blocker or sitting in/after a cycle, id-sorted. */
  blocked: string[];
  /** Full topological order of the open, non-cyclic tasks (sources first). */
  order: string[];
  /** Open tasks that can never proceed because they sit in/after a blocking cycle, id-sorted. */
  cycles: string[];
  hasCycle: boolean;
  /** The longest blocking chain among open tasks (blocker → … → most-blocked), the task critical chain. */
  longestChain: string[];
  counts: { ready: number; blocked: number; closed: number; cyclic: number };
}

/**
 * Solve the task blocking graph. Edges referencing unknown tasks (or self-edges) are ignored; a closed
 * (done/dropped) blocker is treated as satisfied. Blocking edges among only OPEN tasks form the "live" graph
 * over which readiness, cycles and the critical chain are computed. Empty ⇒ empty.
 */
export function resolveTaskDependencies(
  tasks: readonly DependencyTask[],
  edges: readonly TaskDependencyEdge[],
): TaskDependencyResult {
  // Normalise tasks (fail-closed: drop non-objects / blank ids; first occurrence of an id wins).
  const status = new Map<string, string | null>();
  const closed = new Map<string, boolean>();
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      if (t === null || typeof t !== "object") continue;
      const id = String((t as DependencyTask).id ?? "");
      if (id === "" || status.has(id)) continue;
      const st = (t as DependencyTask).status === undefined || (t as DependencyTask).status === null ? null : String((t as DependencyTask).status);
      status.set(id, st);
      closed.set(id, isTaskStatusClosed(st));
    }
  }

  // Live blocking edges: both endpoints exist, distinct, and the BLOCKER is still open (a closed blocker no
  // longer blocks). pred(task) = its open blockers; succ(blocker) = open tasks it blocks. Deduped.
  const pred = new Map<string, Set<string>>();
  const succ = new Map<string, Set<string>>();
  for (const id of status.keys()) {
    pred.set(id, new Set());
    succ.set(id, new Set());
  }
  if (Array.isArray(edges)) {
    for (const e of edges) {
      if (e === null || typeof e !== "object") continue;
      const taskId = String((e as TaskDependencyEdge).taskId ?? "");
      const blockedBy = String((e as TaskDependencyEdge).blockedBy ?? "");
      if (!status.has(taskId) || !status.has(blockedBy) || taskId === blockedBy) continue;
      if (closed.get(taskId)) continue; // a closed task's readiness is moot
      if (closed.get(blockedBy)) continue; // a closed blocker is satisfied ⇒ not a live edge
      pred.get(taskId)!.add(blockedBy);
      succ.get(blockedBy)!.add(taskId);
    }
  }

  const openIds = [...status.keys()].filter((id) => !closed.get(id));

  // Kahn topological sort over the OPEN live subgraph (indeg = number of open blockers).
  const indeg = new Map<string, number>();
  for (const id of openIds) indeg.set(id, pred.get(id)!.size);
  const queue = openIds.filter((id) => indeg.get(id) === 0).sort(byStr);
  const order: string[] = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    order.push(id);
    const newly: string[] = [];
    for (const s of succ.get(id)!) {
      if (closed.get(s)) continue;
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) newly.push(s);
    }
    for (const n of newly.sort(byStr)) queue.push(n); // id-sorted enqueue ⇒ deterministic order
  }
  const inOrder = new Set(order);
  const cyclic = openIds.filter((id) => !inOrder.has(id)); // in/after a blocking cycle

  // Longest blocking chain (depth) over the acyclic open subgraph, with parent links for reconstruction.
  const depth = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const id of order) {
    let best = 0;
    let via: string | null = null;
    for (const p of pred.get(id)!) {
      if (!inOrder.has(p)) continue;
      const d = depth.get(p)! + 1;
      if (d > best || (d === best && (via === null || byStr(p, via) < 0))) {
        best = d;
        via = p;
      }
    }
    depth.set(id, best);
    parent.set(id, via);
  }
  // Reconstruct the longest chain (blocker → … → most-blocked); id-tiebroken tail pick.
  let tail: string | null = null;
  let maxDepth = -1;
  for (const id of order) {
    const d = depth.get(id)!;
    if (d > maxDepth || (d === maxDepth && (tail === null || byStr(id, tail) < 0))) {
      maxDepth = d;
      tail = id;
    }
  }
  const longestChain: string[] = [];
  for (let cur = tail; cur !== null && cur !== undefined; cur = parent.get(cur) ?? null) longestChain.unshift(cur);
  // A single node with no blockers is not a "chain".
  const chain = longestChain.length > 1 ? longestChain : [];

  const nodes: Record<string, TaskDependencyNode> = {};
  for (const id of [...status.keys()].sort(byStr)) {
    const isClosed = closed.get(id)!;
    const openBlockers = [...pred.get(id)!].sort(byStr);
    const openBlocks = [...succ.get(id)!].filter((s) => !closed.get(s)).sort(byStr);
    const inCyc = !isClosed && !inOrder.has(id);
    const readiness: TaskReadiness = isClosed ? "closed" : inCyc || openBlockers.length > 0 ? "blocked" : "ready";
    nodes[id] = {
      id,
      status: status.get(id)!,
      closed: isClosed,
      readiness,
      blockedBy: openBlockers,
      blocks: openBlocks,
      inCycle: inCyc,
      depth: isClosed ? 0 : depth.get(id) ?? 0,
    };
  }

  const readyNow = order.filter((id) => pred.get(id)!.size === 0).sort(byStr);
  const blocked = openIds.filter((id) => !inOrder.has(id) || pred.get(id)!.size > 0).sort(byStr);
  const closedCount = [...closed.values()].filter(Boolean).length;

  return {
    nodes,
    readyNow,
    blocked,
    order,
    cycles: cyclic.sort(byStr),
    hasCycle: cyclic.length > 0,
    longestChain: chain,
    counts: { ready: readyNow.length, blocked: blocked.length, closed: closedCount, cyclic: cyclic.length },
  };
}
