import { test } from "node:test";
import assert from "node:assert/strict";
import { retentionSourceFromEnv } from "./retention-source";

test("selects a source per RETENTION_BACKEND and requires its config", () => {
  assert.throws(() => retentionSourceFromEnv({ RETENTION_BACKEND: "s3" } as NodeJS.ProcessEnv), /RETENTION_S3_BUCKET/);
  assert.throws(() => retentionSourceFromEnv({ RETENTION_BACKEND: "dynamodb" } as NodeJS.ProcessEnv), /RETENTION_DDB_TABLE/);
  assert.throws(() => retentionSourceFromEnv({ RETENTION_BACKEND: "bigquery" } as NodeJS.ProcessEnv), /RETENTION_BQ_DATASET/);
});

test("rejects an unknown or missing backend", () => {
  assert.throws(() => retentionSourceFromEnv({} as NodeJS.ProcessEnv), /must be one of/);
  assert.throws(() => retentionSourceFromEnv({ RETENTION_BACKEND: "floppy" } as NodeJS.ProcessEnv), /must be one of/);
});

test("builds an S3 source when fully configured (no network at construction)", () => {
  const src = retentionSourceFromEnv({ RETENTION_BACKEND: "s3", RETENTION_S3_BUCKET: "b", AWS_REGION: "us-east-1" } as NodeJS.ProcessEnv);
  assert.equal(typeof src.readSnapshots, "function");
  assert.equal(typeof src.appendJournal, "function");
});
