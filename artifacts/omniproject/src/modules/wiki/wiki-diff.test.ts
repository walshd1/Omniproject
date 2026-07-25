import { describe, it, expect } from "vitest";
import type { DocBlock } from "@workspace/backend-catalogue";
import { diffDocBlocks, summarizeDiff, blocksDiffer } from "./wiki-diff";

/** Structural block diff for wiki version history: align by id, compare by deep value. */
const p = (id: string, text: string): DocBlock => ({ id, type: "paragraph", text });

describe("diffDocBlocks", () => {
  it("classifies added, removed, changed and unchanged blocks (next-order, removed appended)", () => {
    const prev = [p("a", "one"), p("b", "two"), p("c", "three")];
    const next = [p("a", "one"), p("b", "TWO"), p("d", "four")]; // b changed, c removed, d added
    const diff = diffDocBlocks(prev, next);
    expect(diff.map((d) => [d.block.id, d.status])).toEqual([
      ["a", "unchanged"],
      ["b", "changed"],
      ["d", "added"],
      ["c", "removed"],
    ]);
    // A changed block carries its prior state for a side-by-side.
    expect(diff.find((d) => d.block.id === "b")!.prevBlock).toMatchObject({ text: "two" });
  });

  it("summarizes a diff into per-status counts", () => {
    const diff = diffDocBlocks([p("a", "1"), p("b", "2")], [p("a", "1"), p("b", "X"), p("c", "3")]);
    expect(summarizeDiff(diff)).toEqual({ added: 1, removed: 0, changed: 1, unchanged: 1 });
  });

  it("blocksDiffer is false for identical lists and true when anything moved/changed", () => {
    expect(blocksDiffer([p("a", "1")], [p("a", "1")])).toBe(false);
    expect(blocksDiffer([p("a", "1")], [p("a", "2")])).toBe(true);
    expect(blocksDiffer([p("a", "1")], [p("a", "1"), p("b", "2")])).toBe(true);
  });
});
