/**
 * BigQuery-backed `WarehousePort` (also fits Snowflake/Redshift with a different client). The client
 * is INJECTED (a minimal `BigQueryLike` shape) for testability; `bigQueryFromEnv` builds the real one.
 * The connector's SQL uses unqualified `FROM journal` / `FROM snapshot`; this port rewrites them to
 * the real dataset-qualified table ids and passes the connector's bound `@params` straight through.
 */
import { BigQuery } from "@google-cloud/bigquery";
import type { WarehousePort, WarehouseQuery } from "../contract";

/** A running query job — used for DML, where the affected-row count lives in the job statistics. */
export interface BigQueryJobLike {
  getQueryResults(): Promise<[Record<string, unknown>[], ...unknown[]]>;
  getMetadata(): Promise<[{ statistics?: { query?: { numDmlAffectedRows?: string | number } } }, ...unknown[]]>;
}

/** The minimal BigQuery surface the port uses (the real client satisfies it structurally). */
export interface BigQueryLike {
  dataset(id: string): { table(name: string): { insert(rows: Record<string, unknown>[]): Promise<unknown> } };
  query(opts: { query: string; params?: Record<string, unknown> }): Promise<[Record<string, unknown>[], ...unknown[]]>;
  createQueryJob(opts: { query: string; params?: Record<string, unknown> }): Promise<[BigQueryJobLike, ...unknown[]]>;
}

export interface BigQueryPortConfig {
  bq: BigQueryLike;
  dataset: string;
  /** Real table ids (default "journal"/"snapshot"). */
  tables?: { journal?: string; snapshot?: string };
}

/** BigQuery identifiers are spliced into backticked table refs, so restrict them to a safe charset. */
function safeIdent(id: string, what: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`bigquery: invalid ${what} ${JSON.stringify(id)}`);
  return id;
}

export function bigQueryWarehousePort(cfg: BigQueryPortConfig): WarehousePort {
  const dataset = safeIdent(cfg.dataset, "dataset");
  const journalTable = safeIdent(cfg.tables?.journal ?? "journal", "journal table");
  const snapshotTable = safeIdent(cfg.tables?.snapshot ?? "snapshot", "snapshot table");
  const qualify = (sql: string): string =>
    sql
      .replace(/\bFROM\s+snapshot\b/g, `FROM \`${dataset}.${snapshotTable}\``)
      .replace(/\bFROM\s+journal\b/g, `FROM \`${dataset}.${journalTable}\``);

  return {
    async insertRows(table, rows) {
      const name = table === "journal" ? journalTable : snapshotTable;
      await cfg.bq.dataset(dataset).table(name).insert(rows);
    },
    async query(q: WarehouseQuery) {
      const [rows] = await cfg.bq.query({ query: qualify(q.sql), params: q.params });
      return rows;
    },
    async execute(q: WarehouseQuery) {
      // DML: run as a job so the affected-row count is readable from job statistics.
      const [job] = await cfg.bq.createQueryJob({ query: qualify(q.sql), params: q.params });
      await job.getQueryResults();
      const [meta] = await job.getMetadata();
      return { rowsAffected: Number(meta.statistics?.query?.numDmlAffectedRows ?? 0) };
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
