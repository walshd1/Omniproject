/**
 * TASK SUBTASK TREE — pure. Builds a parent/child tree from a flat task list over `parentTaskId`, and
 * flattens it back to the visible rows a list renders (honouring a fold set). No I/O, no state — the fold
 * set lives in localStorage at the UI edge and is passed in. Robust to real data: a task whose parent is
 * missing from the set becomes a root (never dropped), and a parent cycle is broken (a node is placed once),
 * so the tree always renders every task exactly once.
 */

export interface TreeTask {
  id: string;
  parentTaskId?: string | null;
  sortOrder?: number | null;
}

export interface TaskTreeNode<T extends TreeTask> {
  task: T;
  children: TaskTreeNode<T>[];
  depth: number;
}

/** Build the forest of task nodes. Children are ordered by `sortOrder` (then original order) within a parent.
 *  A missing/self/cyclic parent link resolves the node to a root, so every task appears exactly once. */
export function buildTaskTree<T extends TreeTask>(tasks: readonly T[]): TaskTreeNode<T>[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const nodes = new Map<string, TaskTreeNode<T>>(tasks.map((t) => [t.id, { task: t, children: [], depth: 0 }]));

  // Walking up from `id`, does the parent chain lead back to `id` (a cycle)?
  const leadsToCycle = (id: string): boolean => {
    let p = byId.get(id)!.parentTaskId ?? null;
    const seen = new Set<string>();
    while (p) {
      if (p === id) return true;         // chain returns to the start → cycle
      if (seen.has(p) || !byId.has(p)) return false; // terminates elsewhere / dangles → not this node's cycle
      seen.add(p);
      p = byId.get(p)!.parentTaskId ?? null;
    }
    return false;
  };
  // A parent is honoured only when present, not self, and not part of a cycle back to the node.
  const effectiveParent = (t: T): string | null => {
    const p = t.parentTaskId ?? null;
    if (!p || p === t.id || !byId.has(p)) return null;
    return leadsToCycle(t.id) ? null : p;
  };

  const roots: TaskTreeNode<T>[] = [];
  for (const t of tasks) {
    const node = nodes.get(t.id)!;
    const parentId = effectiveParent(t);
    if (parentId && nodes.has(parentId)) nodes.get(parentId)!.children.push(node);
    else roots.push(node);
  }

  const order = (a: TaskTreeNode<T>, b: TaskTreeNode<T>): number => (a.task.sortOrder ?? 0) - (b.task.sortOrder ?? 0);
  const stamp = (list: TaskTreeNode<T>[], depth: number): void => {
    list.sort(order);
    for (const n of list) { n.depth = depth; stamp(n.children, depth + 1); }
  };
  stamp(roots, 0);
  return roots;
}

/** True when a task has at least one child in the tree (so the UI shows a fold/unfold caret). */
export function hasChildren<T extends TreeTask>(node: TaskTreeNode<T>): boolean {
  return node.children.length > 0;
}

/**
 * The ids of every descendant of `rootId` (its children, their children, …), NOT including `rootId` itself.
 * Used by a re-parent picker to exclude a task's own subtree — you can't move a task under one of its own
 * descendants without creating a cycle. Uses the effective (cycle-broken) tree, so it's always finite.
 */
export function descendantIds<T extends TreeTask>(tasks: readonly T[], rootId: string): Set<string> {
  const roots = buildTaskTree(tasks);
  const out = new Set<string>();
  const find = (list: TaskTreeNode<T>[]): TaskTreeNode<T> | null => {
    for (const n of list) {
      if (n.task.id === rootId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const collect = (n: TaskTreeNode<T>): void => { for (const c of n.children) { out.add(c.task.id); collect(c); } };
  const root = find(roots);
  if (root) collect(root);
  return out;
}

/**
 * Flatten the forest to the VISIBLE rows in render order (depth-first), skipping the descendants of any node
 * whose id is in `folded`. Each row carries its depth (for indent) and whether it has children (for the caret).
 */
export function flattenTaskTree<T extends TreeTask>(
  roots: readonly TaskTreeNode<T>[],
  folded: ReadonlySet<string> = new Set(),
): Array<{ task: T; depth: number; hasChildren: boolean }> {
  const out: Array<{ task: T; depth: number; hasChildren: boolean }> = [];
  const walk = (node: TaskTreeNode<T>): void => {
    out.push({ task: node.task, depth: node.depth, hasChildren: node.children.length > 0 });
    if (!folded.has(node.task.id)) for (const c of node.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}
