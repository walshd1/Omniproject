import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import type { DocBlock } from "@workspace/backend-catalogue";
import { readBlocks, writeBlocks, seedBlocksIfEmpty, seedUpdateFromBlocks, blocksArray, toBase64, fromBase64 } from "./collab-doc";

/** The pure Yjs block-document core: block↔CRDT mapping + convergence under concurrent edits. */
const p = (id: string, text: string): DocBlock => ({ id, type: "paragraph", text });

/** Exchange full state between two docs (both converge) — models a sync after an offline divergence. */
function sync(a: Y.Doc, b: Y.Doc) {
  const ua = Y.encodeStateAsUpdate(a);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
}

describe("collab-doc core", () => {
  it("round-trips blocks through the shared doc", () => {
    const doc = new Y.Doc();
    const blocks: DocBlock[] = [
      { id: "h", type: "heading", text: "Title", level: 2 },
      { id: "l", type: "checklist", items: [{ text: "a", checked: true }, { text: "b" }] },
      p("body", "hello"),
    ];
    writeBlocks(doc, blocks);
    expect(readBlocks(doc)).toEqual(blocks);
  });

  it("reconciles field edits, additions, removals and reorders without churn", () => {
    const doc = new Y.Doc();
    writeBlocks(doc, [p("a", "one"), p("b", "two"), p("c", "three")]);
    // Edit b, drop c, add d, and move a to the end.
    writeBlocks(doc, [p("b", "TWO"), p("d", "four"), p("a", "one")]);
    expect(readBlocks(doc)).toEqual([p("b", "TWO"), p("d", "four"), p("a", "one")]);
  });

  it("a no-op reconcile emits no update (idempotent)", () => {
    const doc = new Y.Doc();
    writeBlocks(doc, [p("a", "one"), p("b", "two")]);
    let updates = 0;
    doc.on("update", () => { updates++; });
    writeBlocks(doc, [p("a", "one"), p("b", "two")]); // identical
    expect(updates).toBe(0);
  });

  it("merges concurrent edits to DIFFERENT blocks (both survive)", () => {
    const a = new Y.Doc();
    writeBlocks(a, [p("b1", "one"), p("b2", "two")]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // b starts synced to a

    // Diverge offline: each edits a DIFFERENT block (each only writes the field it changed).
    writeBlocks(a, [p("b1", "ONE"), p("b2", "two")]);
    writeBlocks(b, [p("b1", "one"), p("b2", "TWO")]);

    sync(a, b);
    // Converged: b1's edit from A and b2's edit from B both survive — no whole-doc clobber.
    expect(readBlocks(a)).toEqual(readBlocks(b));
    expect(Object.fromEntries(readBlocks(a).map((x) => [x.id, x.text]))).toEqual({ b1: "ONE", b2: "TWO" });
  });

  it("a concurrent insert on each side keeps BOTH new blocks after sync", () => {
    const a = new Y.Doc();
    writeBlocks(a, [p("base", "x")]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Each appends a different block offline.
    writeBlocks(a, [p("base", "x"), p("fromA", "a")]);
    writeBlocks(b, [p("base", "x"), p("fromB", "b")]);
    sync(a, b);
    expect(readBlocks(a)).toEqual(readBlocks(b));
    expect(new Set(readBlocks(a).map((x) => x.id))).toEqual(new Set(["base", "fromA", "fromB"]));
  });

  it("seedBlocksIfEmpty seeds an empty doc but not one that already has content", () => {
    const doc = new Y.Doc();
    expect(seedBlocksIfEmpty(doc, [p("a", "one")])).toBe(true);
    expect(blocksArray(doc).length).toBe(1);
    // A second seed (e.g. after syncing peer state) is refused.
    expect(seedBlocksIfEmpty(doc, [p("z", "other")])).toBe(false);
    expect(readBlocks(doc)).toEqual([p("a", "one")]);
  });

  it("deterministic seed: two clients seeding the same blocks converge WITHOUT duplication", () => {
    const blocks = [p("b1", "one"), p("b2", "two")];
    // Two clients independently seed from the same persisted blocks, then sync.
    const a = new Y.Doc();
    Y.applyUpdate(a, seedUpdateFromBlocks(blocks));
    const b = new Y.Doc();
    Y.applyUpdate(b, seedUpdateFromBlocks(blocks));
    sync(a, b);
    // Idempotent: the shared doc has exactly the seeded blocks once each, not duplicated.
    expect(readBlocks(a)).toEqual(blocks);
    expect(readBlocks(b)).toEqual(blocks);
    expect(blocksArray(a).length).toBe(2);
  });

  it("base64 codec round-trips a binary update and rejects garbage", () => {
    const doc = new Y.Doc();
    writeBlocks(doc, [p("a", "one")]);
    const update = Y.encodeStateAsUpdate(doc);
    const b64 = toBase64(update);
    const back = fromBase64(b64);
    expect(back).not.toBeNull();
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, back!);
    expect(readBlocks(doc2)).toEqual([p("a", "one")]);
    expect(fromBase64("!!!not base64!!!")).toBeNull();
  });
});
