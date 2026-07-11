/**
 * Pick a retention backend from the environment and assemble a `RetentionSource` by feeding the
 * SDK-backed port into the gateway's PURE connector algebra (shared via `contract`). This is the only
 * place the three worlds meet: env config → SDK port → pure key/query logic → RetentionSource.
 */
import {
  objectStoreRetentionSource,
  tableStoreRetentionSource,
  warehouseRetentionSource,
  type RetentionSource,
} from "./contract";
import { s3ObjectStorePort, s3ClientFromEnv } from "./ports/s3";
import { dynamoTableStorePort, dynamoDocFromEnv } from "./ports/dynamo";
import { bigQueryWarehousePort, bigQueryFromEnv } from "./ports/bigquery";

export type Backend = "s3" | "dynamodb" | "bigquery";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is required for the chosen RETENTION_BACKEND`);
  return v;
}

export function retentionSourceFromEnv(env: NodeJS.ProcessEnv = process.env): RetentionSource {
  const backend = (env["RETENTION_BACKEND"] ?? "").trim().toLowerCase();
  switch (backend) {
    case "s3":
      return objectStoreRetentionSource(
        s3ObjectStorePort({ client: s3ClientFromEnv(env), bucket: required(env, "RETENTION_S3_BUCKET") }),
      );
    case "dynamodb":
      return tableStoreRetentionSource(
        dynamoTableStorePort({ doc: dynamoDocFromEnv(env), table: required(env, "RETENTION_DDB_TABLE") }),
      );
    case "bigquery":
      return warehouseRetentionSource(
        bigQueryWarehousePort({ bq: bigQueryFromEnv(env), dataset: required(env, "RETENTION_BQ_DATASET") }),
      );
    default:
      throw new Error(`RETENTION_BACKEND must be one of: s3 | dynamodb | bigquery (got "${backend}")`);
  }
}
