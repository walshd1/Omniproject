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
  /** Delete a key. Needed for retention disposal + right-to-erasure. */
  delete(key: string): Promise<void>;
}

const enc = encodeURIComponent;

/**
 * `changedAt`/`asOf` are embedded verbatim in the key (they must stay lexically sortable, so they are
 * NOT percent-encoded). Guard them: a `/` or `#` would inject extra key segments and corrupt the
 * "lexical order = time order" layout. Valid ISO-8601 timestamps never contain either character.
 */
function safeTimestamp(t: string, field: string): string {
  if (t.includes("/") || t.includes("#") || Number.isNaN(Date.parse(t))) {
    throw new Error(`object-store: unsafe ${field} timestamp ${JSON.stringify(t)}`);
  }
  return t;
}

function journalKey(e: HistoryEntry): string {
  return `journal/${enc(e.entity)}/${enc(e.id)}/${safeTimestamp(e.changedAt, "changedAt")}#${enc(e.txnId)}#${enc(e.field)}.json`;
}
function journalPrefix(entity: string, id: string): string {
  return `journal/${enc(entity)}/${enc(id)}/`;
}
function snapshotKey(s: EntitySnapshot): string {
  return `snapshot/${enc(s.entity)}/${enc(s.id)}/${safeTimestamp(s.asOf, "asOf")}.json`;
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
/** Decode the entity/id from a "journal|snapshot/{enc(entity)}/{enc(id)}/…" key, or null if malformed. */
function entityIdFromKey(key: string): { entity: string; id: string } | null {
  const parts = key.split("/");
  if (parts.length < 4 || (parts[0] !== "journal" && parts[0] !== "snapshot")) return null;
  try {
    return { entity: decodeURIComponent(parts[1]!), id: decodeURIComponent(parts[2]!) };
  } catch {
    return null;
  }
}
/** The `changedAt` embedded in a journal key ("…/{changedAt}#{txnId}#{field}.json") — before the first `#`. */
function changedAtFromJournalKey(key: string): string {
  const leaf = key.slice(key.lastIndexOf("/") + 1);
  return leaf.split("#")[0] ?? "";
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

    async disposeOlderThan(cutoffIso, opts) {
      // The timestamp is embedded in the key, so disposal is a prefix scan + age filter — no reads.
      const held = new Set(opts?.heldKeys ?? []);
      const cutoffMs = Date.parse(cutoffIso);
      const heldKey = (k: string): boolean => {
        const ei = entityIdFromKey(k);
        return !!ei && held.has(`${ei.entity}#${ei.id}`);
      };
      const [jKeys, sKeys] = await Promise.all([port.list("journal/"), port.list("snapshot/")]);
      const jDel = jKeys.filter((k) => Date.parse(changedAtFromJournalKey(k)) < cutoffMs && !heldKey(k));
      const sDel = sKeys.filter((k) => Date.parse(asOfFromKey(k)) < cutoffMs && !heldKey(k));
      await Promise.all([...jDel, ...sDel].map((k) => port.delete(k)));
      return { snapshots: sDel.length, journal: jDel.length };
    },

    async eraseEntity(entity, id) {
      const [jKeys, sKeys] = await Promise.all([port.list(journalPrefix(entity, id)), port.list(snapshotPrefix(entity, id))]);
      await Promise.all([...jKeys, ...sKeys].map((k) => port.delete(k)));
      return { snapshots: sKeys.length, journal: jKeys.length };
    },
  };
}
