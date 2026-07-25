import type { DocBlock } from "@workspace/backend-catalogue";

/**
 * Structural diff between two wiki document block lists (roadmap 2.1 — version history). Wiki bodies are
 * stored as neutral `DocBlock[]` JSON (never HTML), so a diff is structural, not textual: blocks are aligned
 * by their stable `id` and compared by deep value-equality. This is a pure view helper — no dependency on a
 * text-diff library — used to show "what changed since this revision".
 */

export type BlockDiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface BlockDiff {
  status: BlockDiffStatus;
  /** The block as it is in `next` (or, for a removed block, as it was in `prev`). */
  block: DocBlock;
  /** The prior block when it changed — for a side-by-side. */
  prevBlock?: DocBlock;
}

/** Deep value-equality via canonical JSON (block fields are plain JSON — strings, numbers, arrays). */
function sameBlock(a: DocBlock, b: DocBlock): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff `prev` → `next`, aligning blocks by id. Blocks present in `next` come first in `next` order
 * (added / changed / unchanged), then blocks that were removed (present in `prev`, gone from `next`) in
 * `prev` order. A reused id whose content differs is `changed` (carrying `prevBlock`); identical content is
 * `unchanged`.
 */
export function diffDocBlocks(prev: readonly DocBlock[], next: readonly DocBlock[]): BlockDiff[] {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextIds = new Set(next.map((b) => b.id));
  const out: BlockDiff[] = [];
  for (const b of next) {
    const p = prevById.get(b.id);
    if (!p) out.push({ status: "added", block: b });
    else if (!sameBlock(p, b)) out.push({ status: "changed", block: b, prevBlock: p });
    else out.push({ status: "unchanged", block: b });
  }
  for (const b of prev) if (!nextIds.has(b.id)) out.push({ status: "removed", block: b });
  return out;
}

/** A one-line tally of a diff, e.g. `{ added: 1, removed: 0, changed: 2, unchanged: 3 }`. */
export function summarizeDiff(diff: readonly BlockDiff[]): Record<BlockDiffStatus, number> {
  const tally: Record<BlockDiffStatus, number> = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const d of diff) tally[d.status]++;
  return tally;
}

/** Whether two block lists differ at all (any add/remove/change). */
export function blocksDiffer(prev: readonly DocBlock[], next: readonly DocBlock[]): boolean {
  return diffDocBlocks(prev, next).some((d) => d.status !== "unchanged");
}
