/**
 * WORK-ITEM HIERARCHY PROGRESS ROLL-UP — the epic → story → task progress fold every portfolio tool shows:
 * a parent's completion is the WEIGHTED progress of its children, recursively, so an epic reads 62% because
 * its stories do — not because someone typed 62% (roadmap §5.5, "Epics/work-item hierarchy — parentId
 * field/relationship"). Distinct from `critical-path` (which schedules a dependency DAG) and
 * `task-dependencies` (blockedBy edges): this folds a parent/child TREE.
 *
 * A leaf's progress is its own (an explicit 0…1 fraction, or derived from status — a `done`-class status is
 * 1, a `cancelled` leaf is excluded from its parent's weight, anything else is 0). A parent's rolled progress
 * is the child-weight-weighted mean of its children's rolled progress (weight defaults to 1, or story points
 * when supplied). REUSES the shipped `work-vocabulary` `statusClassOf` + the `num` guarded helpers; mirrors
 * the catalogue's records-in / pure-fold / sorted-out shape.
 *
 * Pure, no I/O, DETERMINISTIC (no `Date`, no `Math.random`; nodes id-sorted, children folded in id order).
 * Validation-first and fail-closed: ids coerced, non-object rows dropped, a `parentId` that is unknown or
 * self is treated as ROOT, progress clamped to [0,1], weights coerced to ≥ 0, and CYCLES are broken (a node
 * already on the current fold stack contributes nothing rather than looping) — it never throws. Empty ⇒
 * empty.
 */
import { statusClassOf } from "./work-vocabulary";
import { numLoose, clamp, round2 } from "./num";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface HierarchyItem {
  id: string;
  /** The parent's id; absent / unknown / self ⇒ this node is a root. */
  parentId?: string | null;
  /** Work-item status; used to derive a leaf's progress when `progress` is absent. */
  status?: string | null;
  /** Explicit own progress 0…1 (coerced + clamped). Absent ⇒ derived from status (done = 1, else 0). */
  progress?: number | null;
  /** Weight in a parent's roll-up (story points / size). Coerced to ≥ 0, default 1. */
  weight?: number | null;
}

export interface HierarchyNode {
  id: string;
  /** The resolved parent id, or null for a root. */
  parentId: string | null;
  /** Distance from a root (roots are 0). */
  depth: number;
  /** This node's OWN progress (leaf value; for a parent it's the typed value, informational). */
  ownProgress: number;
  /** The rolled-up progress: a leaf's own value, or the weighted mean of its children's rolled progress. */
  rolledProgress: number;
  weight: number;
  isLeaf: boolean;
  childCount: number;
  /** All nodes beneath this one. */
  descendantCount: number;
  /** Descendants whose rolled progress is 1 (fully complete). */
  doneDescendants: number;
}

export interface HierarchyRollupResult {
  /** Every node with its rolled-up progress, id-sorted. */
  nodes: HierarchyNode[];
  /** Root node ids (no known parent), id-sorted. */
  roots: string[];
  summary: {
    total: number;
    roots: number;
    maxDepth: number;
    /** Weighted mean rolled progress across the roots, 2dp; null when nothing carries weight. */
    overallProgress: number | null;
  };
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

interface Resolved {
  id: string;
  parentId: string | null;
  ownProgress: number;
  /** A cancelled leaf is excluded from its parent's weighted mean. */
  excluded: boolean;
  weight: number;
}

/**
 * Roll a work-item hierarchy up: each parent's progress becomes the weighted mean of its children's rolled
 * progress. Deterministic, cycle-safe, fail-closed, empty ⇒ empty.
 */
export function rollUpHierarchy(items: readonly HierarchyItem[]): HierarchyRollupResult {
  // Resolve every valid node first, so parent-id validity can be checked against the known set.
  const resolved = new Map<string, Resolved>();
  if (Array.isArray(items)) {
    for (const raw of items) {
      if (raw === null || typeof raw !== "object") continue;
      const it = raw as HierarchyItem;
      const id = coerceId(it.id);
      if (id === null || resolved.has(id)) continue;
      const cls = statusClassOf(typeof it.status === "string" ? it.status : "");
      const ownProgress = it.progress === undefined || it.progress === null ? (cls === "done" ? 1 : 0) : clamp(numLoose(it.progress), 0, 1);
      resolved.set(id, {
        id,
        parentId: coerceId(it.parentId),
        ownProgress,
        excluded: cls === "cancelled",
        weight: Math.max(0, numLoose(it.weight ?? 1)),
      });
    }
  }

  // Resolve parent links: an unknown or self parent ⇒ root. Build the children index (id-sorted per parent).
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string | null>();
  for (const node of resolved.values()) {
    const parent = node.parentId !== null && node.parentId !== node.id && resolved.has(node.parentId) ? node.parentId : null;
    parentOf.set(node.id, parent);
    if (parent !== null) (children.get(parent) ?? children.set(parent, []).get(parent)!).push(node.id);
  }
  for (const list of children.values()) list.sort(byId);

  // Rolled progress via memoised DFS; a node already on the stack (cycle) contributes nothing.
  const rolledCache = new Map<string, number>();
  const rolled = (id: string, stack: Set<string>): number => {
    const cached = rolledCache.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0; // cycle — break rather than loop
    const node = resolved.get(id)!;
    const kids = (children.get(id) ?? []).map((c) => resolved.get(c)!).filter((c) => !c.excluded);
    let value: number;
    if (kids.length === 0) {
      value = node.ownProgress;
    } else {
      stack.add(id);
      let weighted = 0, total = 0;
      for (const c of kids) { weighted += rolled(c.id, stack) * c.weight; total += c.weight; }
      stack.delete(id);
      value = total > 0 ? weighted / total : node.ownProgress; // guarded: all-zero-weight ⇒ own value
    }
    rolledCache.set(id, value);
    return value;
  };

  // Descendant aggregates via the same memoised structure.
  const descCache = new Map<string, { desc: number; done: number }>();
  const aggregate = (id: string, stack: Set<string>): { desc: number; done: number } => {
    const cached = descCache.get(id);
    if (cached) return cached;
    if (stack.has(id)) return { desc: 0, done: 0 };
    stack.add(id);
    let desc = 0, done = 0;
    for (const c of children.get(id) ?? []) {
      const sub = aggregate(c, stack);
      desc += 1 + sub.desc;
      done += (rolled(c, new Set()) >= 1 ? 1 : 0) + sub.done;
    }
    stack.delete(id);
    const out = { desc, done };
    descCache.set(id, out);
    return out;
  };

  const depthOf = (id: string): number => {
    let depth = 0;
    let cur = parentOf.get(id) ?? null;
    const guard = new Set<string>([id]);
    while (cur !== null && !guard.has(cur)) { depth++; guard.add(cur); cur = parentOf.get(cur) ?? null; }
    return depth;
  };

  const nodes: HierarchyNode[] = [...resolved.keys()].sort(byId).map((id) => {
    const node = resolved.get(id)!;
    const kids = children.get(id) ?? [];
    const agg = aggregate(id, new Set());
    return {
      id,
      parentId: parentOf.get(id) ?? null,
      depth: depthOf(id),
      ownProgress: round2(node.ownProgress),
      rolledProgress: round2(rolled(id, new Set())),
      weight: node.weight,
      isLeaf: kids.length === 0,
      childCount: kids.length,
      descendantCount: agg.desc,
      doneDescendants: agg.done,
    };
  });

  const roots = [...resolved.keys()].filter((id) => (parentOf.get(id) ?? null) === null).sort(byId);
  let weighted = 0, total = 0;
  for (const id of roots) {
    const node = resolved.get(id)!;
    if (node.excluded) continue;
    weighted += rolled(id, new Set()) * node.weight;
    total += node.weight;
  }

  return {
    nodes,
    roots,
    summary: {
      total: nodes.length,
      roots: roots.length,
      maxDepth: nodes.reduce((m, n) => Math.max(m, n.depth), 0),
      overallProgress: total > 0 ? round2(weighted / total) : null,
    },
  };
}
