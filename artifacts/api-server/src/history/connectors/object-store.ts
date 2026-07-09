/**
 * Object-store retention connector — a `RetentionSource` backed by an S3-compatible object store
 * (AWS S3, GCS, Azure Blob, MinIO — they share the same put/get/list key-value model). It is PURE
 * key-layout + serialisation logic over an injected `ObjectStorePort`; it imports NO cloud SDK, so it
 * stays above the seam and CI-green. The operator's broker/boot layer supplies the SDK-backed port
 * (the same injection pattern as SelfHostDbPort). See docs/RETENTION-CONNECTORS.md.
 *
 * Key layout (lexical order = time order, so a prefix list is a time scan):
 *   journal/{entity}/{id}/{changedAt}#{txnId}#{field}.json
 *   snapshot/{entity}/{id}/{asOf}.json
 */
import type { EntitySnapshot, HistoryEntry, TimeWindow } from "../types";
import type { RetentionSource } from "../retention";

/** The minimal object-store operations the connector needs (S3/GCS/Blob/MinIO all provide these). */
export interface ObjectStorePort {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  /** List keys under a prefix (lexical order). Implementations page internally. */
  list(prefix: string): Promise<string[]>;
}

const enc = encodeURIComponent;

function journalKey(e: HistoryEntry): string {
  return `journal/${enc(e.entity)}/${enc(e.id)}/${e.changedAt}#${enc(e.txnId)}#${enc(e.field)}.json`;
}
function journalPrefix(entity: string, id: string): string {
  return `journal/${enc(entity)}/${enc(id)}/`;
}
function snapshotKey(s: EntitySnapshot): string {
  return `snapshot/${enc(s.entity)}/${enc(s.id)}/${s.asOf}.json`;
}
function snapshotPrefix(entity: string, id: string): string {
  return `snapshot/${enc(entity)}/${enc(id)}/`;
}
/** The `asOf` encoded in a snapshot key (the segment after the last `/`, minus `.json`). */
function asOfFromKey(key: string): string {
  const leaf = key.slice(key.lastIndexOf("/") + 1);
  return leaf.endsWith(".json") ? leaf.slice(0, -".json".length) : leaf;
}
function inWindow(t: string, w: TimeWindow): boolean {
  const ms = Date.parse(t);
  return ms >= Date.parse(w.from) && ms < Date.parse(w.to);
}

/** Build a `RetentionSource` over an object store. `ids` reads fan out one prefix-list per id. */
export function objectStoreRetentionSource(port: ObjectStorePort): RetentionSource {
  return {
    async appendJournal(entries) {
      // One immutable object per field-change — append-only by construction (unique keys).
      await Promise.all(entries.map((e) => port.put(journalKey(e), JSON.stringify(e))));
    },

    async writeSnapshot(snapshot) {
      await port.put(snapshotKey(snapshot), JSON.stringify(snapshot));
    },

    async readJournal(entity, id, window) {
      const keys = await port.list(journalPrefix(entity, id));
      const bodies = await Promise.all(keys.map((k) => port.get(k)));
      return bodies
        .filter((b): b is string => b !== null)
        .map((b) => JSON.parse(b) as HistoryEntry)
        .filter((e) => inWindow(e.changedAt, window))
        .sort((a, b) => (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : 0));
    },

    async readSnapshots(entity, ids, window) {
      const perId = await Promise.all(
        ids.map(async (id) => {
          const keys = await port.list(snapshotPrefix(entity, id));
          const wanted = keys.filter((k) => inWindow(asOfFromKey(k), window));
          const bodies = await Promise.all(wanted.map((k) => port.get(k)));
          return bodies.filter((b): b is string => b !== null).map((b) => JSON.parse(b) as EntitySnapshot);
        }),
      );
      return perId.flat();
    },

    async lastSnapshotAt(entity, id) {
      const keys = await port.list(snapshotPrefix(entity, id));
      if (keys.length === 0) return null;
      // Lexical max of the asOf segment = the most recent snapshot.
      let latest: string | null = null;
      for (const k of keys) {
        const asOf = asOfFromKey(k);
        if (latest === null || asOf > latest) latest = asOf;
      }
      return latest;
    },
  };
}
