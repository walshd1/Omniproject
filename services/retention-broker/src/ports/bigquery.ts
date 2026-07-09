/**
 * BigQuery-backed `WarehousePort` (also fits Snowflake/Redshift with a different client). The client
 * is INJECTED (a minimal `BigQueryLike` shape) for testability; `bigQueryFromEnv` builds the real one.
 * The connector's SQL uses unqualified `FROM journal` / `FROM snapshot`; this port rewrites them to
 * the real dataset-qualified table ids and passes the connector's bound `@params` straight through.
 */
import { BigQuery } from "@google-cloud/bigquery";
import type { WarehousePort, WarehouseQuery } from "../contract";

/** The minimal BigQuery surface the port uses (the real client satisfies it structurally). */
export interface BigQueryLike {
  dataset(id: string): { table(name: string): { insert(rows: Record<string, unknown>[]): Promise<unknown> } };
  query(opts: { query: string; params?: Record<string, unknown> }): Promise<[Record<string, unknown>[], ...unknown[]]>;
}

export interface BigQueryPortConfig {
  bq: BigQueryLike;
  dataset: string;
  /** Real table ids (default "journal"/"snapshot"). */
  tables?: { journal?: string; snapshot?: string };
}

export function bigQueryWarehousePort(cfg: BigQueryPortConfig): WarehousePort {
  const journalTable = cfg.tables?.journal ?? "journal";
  const snapshotTable = cfg.tables?.snapshot ?? "snapshot";
  const qualify = (sql: string): string =>
    sql
      .replace(/\bFROM\s+snapshot\b/g, `FROM \`${cfg.dataset}.${snapshotTable}\``)
      .replace(/\bFROM\s+journal\b/g, `FROM \`${cfg.dataset}.${journalTable}\``);

  return {
    async insertRows(table, rows) {
      const name = table === "journal" ? journalTable : snapshotTable;
      await cfg.bq.dataset(cfg.dataset).table(name).insert(rows);
    },
    async query(q: WarehouseQuery) {
      const [rows] = await cfg.bq.query({ query: qualify(q.sql), params: q.params });
      return rows;
    },
  };
}

export function bigQueryFromEnv(env: NodeJS.ProcessEnv = process.env): BigQueryLike {
  const projectId = env["GOOGLE_CLOUD_PROJECT"];
  const location = env["BIGQUERY_LOCATION"];
  return new BigQuery({
    ...(projectId ? { projectId } : {}),
    ...(location ? { location } : {}),
  }) as unknown as BigQueryLike;
}
