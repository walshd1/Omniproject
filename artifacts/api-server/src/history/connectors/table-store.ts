/**
 * Table-store retention connector — a `RetentionSource` backed by a DynamoDB-style key-value table
 * (also fits Azure Cosmos, Cassandra/Scylla, any single-table PK+SK store). Pure item-shaping + query
 * logic over an injected `TableStorePort`; imports NO cloud SDK, so it stays above the seam and
 * CI-green. The SDK-backed port is supplied by the operator's broker/boot layer.
 *
 * Single-table design (DynamoDB best practice):
 *   PK = "{entity}#{id}"
 *   SK = "SNAP#{asOf}"                      → a snapshot item  (values in `data`)
 *      | "JRNL#{changedAt}#{txnId}#{field}" → a journal item   (entry in `data`)
 * A range query on the SK prefix + between bounds is the window scan; a descending limit-1 query on
 * "SNAP#" is `lastSnapshotAt`.
 */
import type { EntitySnapshot, HistoryEntry } from "../types";
import type { RetentionSource } from "../retention";

/** One stored item. `data` carries the snapshot/journal payload; keys drive the queries. */
export interface TableItem {
  pk: string;
  sk: string;
  data: unknown;
}

/** A sort-key range query: items with `pk`, `sk` starting `skPrefix`, optionally within [from,to]. */
export interface SkQuery {
  pk: string;
  skPrefix: string;
  /** Inclusive lower/upper SK bounds (lexical), when a window is applied. */
  fromSk?: string;
  toSk?: string;
  /** Descending SK order (for latest-first). */
  descending?: boolean;
  /** Max items to return. */
  limit?: number;
}

/** The minimal table operations the connector needs (DynamoDB PutItem + Query map directly). */
export interface TableStorePort {
  putItem(item: TableItem): Promise<void>;
  query(q: SkQuery): Promise<TableItem[]>;
  /** Delete one item by primary key. Needed for retention disposal + right-to-erasure. */
  deleteItem(pk: string, sk: string): Promise<void>;
  /** Full-table scan of all items — used only by age-based disposal. Expensive on a large single table
   *  (add a timestamp GSI for scale); acceptable for a periodic disposal job. */
  scanAll(): Promise<TableItem[]>;
}

/** The timestamp embedded in a sort key: `SNAP#{asOf}` → asOf; `JRNL#{changedAt}#…` → changedAt. */
function timestampFromSk(sk: string): string | null {
  if (sk.startsWith("SNAP#")) return sk.slice("SNAP#".length);
  if (sk.startsWith("JRNL#")) return sk.slice("JRNL#".length).split("#")[0] ?? null;
  return null;
}

const pkOf = (entity: string, id: string): string => `${entity}#${id}`;
const snapSk = (asOf: string): string => `SNAP#${asOf}`;
const jrnlSk = (e: HistoryEntry): string => `JRNL#${e.changedAt}#${e.txnId}#${e.field}`;

/** Build a `RetentionSource` over a single DynamoDB-style table. */
export function tableStoreRetentionSource(port: TableStorePort): RetentionSource {
  return {
    async appendJournal(entries) {
      await Promise.all(
        entries.map((e) => port.putItem({ pk: pkOf(e.entity, e.id), sk: jrnlSk(e), data: e })),
      );
    },

    async writeSnapshot(snapshot) {
      await port.putItem({ pk: pkOf(snapshot.entity, snapshot.id), sk: snapSk(snapshot.asOf), data: snapshot });
    },

    async readJournal(entity, id, window) {
      const items = await port.query({
        pk: pkOf(entity, id),
        skPrefix: "JRNL#",
        fromSk: `JRNL#${window.from}`,
        toSk: `JRNL#${window.to}`,
      });
      return items
        .map((it) => it.data as HistoryEntry)
        // toSk is exclusive on the window's upper bound (half-open [from,to)).
        .filter((e) => Date.parse(e.changedAt) < Date.parse(window.to))
        .sort((a, b) => (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : 0));
    },

    async readSnapshots(entity, ids, window) {
      const perId = await Promise.all(
        ids.map(async (id) => {
          const items = await port.query({
            pk: pkOf(entity, id),
            skPrefix: "SNAP#",
            fromSk: snapSk(window.from),
            toSk: snapSk(window.to),
          });
          return items
            .map((it) => it.data as EntitySnapshot)
            .filter((s) => Date.parse(s.asOf) < Date.parse(window.to));
        }),
      );
      return perId.flat();
    },

    async lastSnapshotAt(entity, id) {
      const items = await port.query({ pk: pkOf(entity, id), skPrefix: "SNAP#", descending: true, limit: 1 });
      if (items.length === 0) return null;
      return (items[0]!.data as EntitySnapshot).asOf;
    },

    async eraseEntity(entity, id) {
      const pk = pkOf(entity, id);
      const [snaps, jrnls] = await Promise.all([
        port.query({ pk, skPrefix: "SNAP#" }),
        port.query({ pk, skPrefix: "JRNL#" }),
      ]);
      await Promise.all([...snaps, ...jrnls].map((it) => port.deleteItem(it.pk, it.sk)));
      return { snapshots: snaps.length, journal: jrnls.length };
    },

    async disposeOlderThan(cutoffIso, opts) {
      // The PK ("entity#id") is exactly the legal-hold key format, so held rows are skipped by pk.
      const held = new Set(opts?.heldKeys ?? []);
      const cutoffMs = Date.parse(cutoffIso);
      const items = await port.scanAll();
      const stale = items.filter((it) => {
        if (held.has(it.pk)) return false;
        const ts = timestampFromSk(it.sk);
        return ts !== null && Date.parse(ts) < cutoffMs;
      });
      await Promise.all(stale.map((it) => port.deleteItem(it.pk, it.sk)));
      const snapshots = stale.filter((it) => it.sk.startsWith("SNAP#")).length;
      return { snapshots, journal: stale.length - snapshots };
    },
  };
}
