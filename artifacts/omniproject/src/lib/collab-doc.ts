import * as Y from "yjs";
import type { DocBlock } from "@workspace/backend-catalogue";

/**
 * Collaborative document core (roadmap 2.1 slice 6 — Yjs co-edit). Maps a wiki document's primitive
 * `DocBlock[]` onto a Yjs CRDT so two people can edit the same page and converge without a lock or a
 * last-writer-wins clobber of the whole doc.
 *
 * MODEL: the blocks live in a `Y.Array` named "blocks", one `Y.Map` per block. Concurrency is at BLOCK
 * granularity — edits to *different* blocks always merge; two people editing the *same* field of the same
 * block resolve last-write-wins on that field (character-level text CRDTs are a later step). This keeps the
 * existing block model, the sanitising choke point and the `block` primitive family exactly as-is: the CRDT
 * is only the live editing layer. Nothing is stored at rest here — persistence still goes through the broker
 * seam (`writeWikiDoc`) when the author saves; the Yjs state is transient, like presence.
 *
 * This module is PURE (no transport, no React) so the convergence rules are unit-testable with two in-memory
 * docs. The hook and the relay build on top of it.
 */

/** The Yjs array of block maps for a doc (created on first access). */
export function blocksArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>("blocks");
}

/** Fields that may appear on a block map, besides the always-present id/type. */
const OPTIONAL_KEYS = ["text", "level", "tone", "items", "rows", "url", "caption"] as const;

/** A plain, JSON-clonable field record for a block (deep-copied so stored values can't alias caller state). */
function blockToRecord(b: DocBlock): Record<string, unknown> {
  const r: Record<string, unknown> = { id: b.id, type: b.type };
  const src = b as unknown as Record<string, unknown>;
  for (const k of OPTIONAL_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    // Deep-copy the compound fields (list items, table rows) so the CRDT owns its own copy.
    r[k] = k === "items" || k === "rows" ? structuredClone(v) : v;
  }
  return r;
}

/** Reconstruct a `DocBlock` from a block map's entries, or null when it lacks a valid id/type. */
function mapToBlock(m: Y.Map<unknown>): DocBlock | null {
  const id = m.get("id");
  const type = m.get("type");
  if (typeof id !== "string" || typeof type !== "string") return null;
  const b: Record<string, unknown> = { id, type };
  for (const k of OPTIONAL_KEYS) {
    const v = m.get(k);
    if (v !== undefined) b[k] = v;
  }
  return b as unknown as DocBlock;
}

/** Set/delete the map's keys so it exactly matches `rec` — only touching keys whose value actually changed,
 *  so a no-op reconcile emits no CRDT ops (and concurrent edits to other keys aren't disturbed). */
function applyRecord(map: Y.Map<unknown>, rec: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(rec)) {
    if (JSON.stringify(map.get(k)) !== JSON.stringify(v)) map.set(k, v);
  }
  for (const k of [...map.keys()]) {
    if (!(k in rec)) map.delete(k);
  }
}

/** Read the current block list out of the shared doc. */
export function readBlocks(doc: Y.Doc): DocBlock[] {
  const out: DocBlock[] = [];
  blocksArray(doc).forEach((m) => { const b = mapToBlock(m); if (b) out.push(b); });
  return out;
}

/**
 * Reconcile the shared doc to match `blocks`, id-keyed and in one transaction: stale blocks removed, new
 * blocks inserted, surviving blocks updated in place (field-level), order fixed. Because it diffs by id and
 * only writes changed fields, a local edit to one block leaves every other block's CRDT state untouched — so
 * a concurrent edit to a different block on another client merges cleanly. Safe to call for the initial seed
 * too (on an empty doc it just inserts). Idempotent: re-running with the same blocks emits no ops.
 */
export function writeBlocks(doc: Y.Doc, blocks: readonly DocBlock[]): void {
  const arr = blocksArray(doc);
  const desiredIds = new Set(blocks.map((b) => b.id));
  Y.transact(doc, () => {
    // 1) Drop blocks that are gone (walk from the end so indices stay valid).
    for (let i = arr.length - 1; i >= 0; i--) {
      const id = arr.get(i).get("id");
      if (typeof id !== "string" || !desiredIds.has(id)) arr.delete(i, 1);
    }
    // 2) Ensure each desired block exists at its target index with matching fields.
    for (let target = 0; target < blocks.length; target++) {
      const b = blocks[target]!;
      let curIdx = -1;
      for (let i = 0; i < arr.length; i++) { if (arr.get(i).get("id") === b.id) { curIdx = i; break; } }
      if (curIdx === -1) {
        const m = new Y.Map<unknown>();
        arr.insert(target, [m]);
        applyRecord(m, blockToRecord(b));
      } else if (curIdx !== target) {
        // A live Y.Map can't be re-inserted; move = delete + fresh insert (block-level, order only).
        arr.delete(curIdx, 1);
        const m = new Y.Map<unknown>();
        arr.insert(target, [m]);
        applyRecord(m, blockToRecord(b));
      } else {
        applyRecord(arr.get(target), blockToRecord(b));
      }
    }
  });
}

/** Seed an EMPTY shared doc from the persisted blocks. No-op when the doc already carries blocks (so a late
 *  joiner that has just synced peer state doesn't re-seed over it). Returns whether it seeded. */
export function seedBlocksIfEmpty(doc: Y.Doc, blocks: readonly DocBlock[]): boolean {
  if (blocksArray(doc).length > 0) return false;
  writeBlocks(doc, blocks);
  return true;
}

/**
 * A DETERMINISTIC initial CRDT update for a block list: seeds a throwaway doc under a FIXED client id (0) so
 * every client computes byte-identical structs from the same persisted blocks. Applying it on multiple
 * clients is therefore IDEMPOTENT — no leader election, and no duplicated blocks when two people open the
 * same page at once (the classic concurrent-seed footgun). Each client's own later edits use its real client
 * id and merge normally on top. This is how the hook initialises a shared doc from the persisted document.
 */
export function seedUpdateFromBlocks(blocks: readonly DocBlock[]): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = 0; // fixed id ⇒ identical struct ids across clients ⇒ idempotent merge
  writeBlocks(seed, blocks);
  return Y.encodeStateAsUpdate(seed);
}

// ── Transport codec (base64 <-> Uint8Array) so binary CRDT updates ride our text SSE frames. ──────────────

/** Encode a binary CRDT update/state-vector as base64 for a JSON/SSE frame. */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Decode a base64 payload back to bytes; returns null on malformed input (never throws). */
export function fromBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
