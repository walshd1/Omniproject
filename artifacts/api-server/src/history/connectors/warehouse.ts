/**
 * Warehouse retention connector — a `RetentionSource` backed by a columnar analytics warehouse
 * (BigQuery; also fits Snowflake, Redshift, ClickHouse). Pure row-shaping + PARAMETERISED query
 * construction over an injected `WarehousePort`; imports NO cloud SDK, so it stays above the seam and
 * CI-green. The SDK-backed port is supplied by the operator's broker/boot layer.
 *
 * Two append-only tables (the port owns their real names):
 *   journal(entity, id, field, old_value, new_value, changed_at, changed_by, txn_id)
 *   snapshot(entity, id, as_of, values JSON, provenance)
 * A warehouse is ideal for trend queries — but the trend maths already lives in `computeSeries`, so
 * this connector only fetches the raw snapshots/journal for a window with BOUND parameters (never
 * string-interpolated values), keeping the same shape as every other source.
 */
import type { EntitySnapshot, HistoryEntry, TimeWindow } from "../types";
import type { RetentionSource } from "../retention";

/** A parameterised query: SQL text with named `@params` and their values. Never interpolate values. */
export interface WarehouseQuery {
  sql: string;
  params: Record<string, unknown>;
}

/** The minimal warehouse operations the connector needs. */
export interface WarehousePort {
  /** Append rows to a logical table ("journal" | "snapshot"); the port maps to the real table id. */
  insertRows(table: "journal" | "snapshot", rows: Record<string, unknown>[]): Promise<void>;
  /** Run a parameterised read query and return the rows. */
  query(q: WarehouseQuery): Promise<Record<string, unknown>[]>;
}

function snapshotRow(s: EntitySnapshot): Record<string, unknown> {
  return { entity: s.entity, id: s.id, as_of: s.asOf, values: JSON.stringify(s.values), provenance: s.provenance };
}
function journalRow(e: HistoryEntry): Record<string, unknown> {
  return {
    entity: e.entity, id: e.id, field: e.field,
    old_value: JSON.stringify(e.oldValue ?? null), new_value: JSON.stringify(e.newValue ?? null),
    changed_at: e.changedAt, changed_by: e.changedBy, txn_id: e.txnId,
  };
}
function toSnapshot(r: Record<string, unknown>): EntitySnapshot {
  const raw = r["values"];
  const values = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : ((raw as Record<string, unknown>) ?? {});
  return {
    entity: String(r["entity"]), id: String(r["id"]), asOf: String(r["as_of"]),
    values, provenance: (r["provenance"] as EntitySnapshot["provenance"]) ?? "replayed",
  };
}

/** Build a `RetentionSource` over a warehouse. Reads use bound `@from`/`@to`/`@entity`/`@ids` params. */
export function warehouseRetentionSource(port: WarehousePort): RetentionSource {
  return {
    async appendJournal(entries) {
      if (entries.length === 0) return;
      await port.insertRows("journal", entries.map(journalRow));
    },

    async writeSnapshot(snapshot) {
      await port.insertRows("snapshot", [snapshotRow(snapshot)]);
    },

    async readJournal(entity, id, window) {
      const rows = await port.query({
        sql: "SELECT * FROM journal WHERE entity = @entity AND id = @id AND changed_at >= @from AND changed_at < @to ORDER BY changed_at",
        params: { entity, id, from: window.from, to: window.to },
      });
      return rows.map((r) => ({
        entity: String(r["entity"]), id: String(r["id"]), field: String(r["field"]),
        oldValue: parseMaybe(r["old_value"]), newValue: parseMaybe(r["new_value"]),
        changedAt: String(r["changed_at"]), changedBy: (r["changed_by"] as string | null) ?? null, txnId: String(r["txn_id"]),
      }));
    },

    async readSnapshots(entity, ids, window) {
      if (ids.length === 0) return [];
      const rows = await port.query({
        sql: "SELECT * FROM snapshot WHERE entity = @entity AND id IN UNNEST(@ids) AND as_of >= @from AND as_of < @to ORDER BY as_of",
        params: { entity, ids, from: window.from, to: window.to },
      });
      return rows.map(toSnapshot);
    },

    async lastSnapshotAt(entity, id) {
      const rows = await port.query({
        sql: "SELECT as_of FROM snapshot WHERE entity = @entity AND id = @id ORDER BY as_of DESC LIMIT 1",
        params: { entity, id },
      });
      return rows.length ? String(rows[0]!["as_of"]) : null;
    },
  };
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Re-exported window type for port implementers. */
export type { TimeWindow };
