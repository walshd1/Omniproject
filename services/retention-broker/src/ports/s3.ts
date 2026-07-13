/**
 * S3-backed `ObjectStorePort` (AWS S3; also GCS/Azure Blob/MinIO via their S3-compatible endpoints).
 * The SDK client is INJECTED so the port is unit-testable with a fake `send`; `s3ClientFromEnv`
 * builds the real client. This is one of the two files in the whole project allowed to import a cloud
 * SDK — it lives below the seam, in the standalone broker service.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { ObjectStorePort } from "../contract";

export interface S3PortConfig {
  client: S3Client;
  bucket: string;
}

export function s3ObjectStorePort(cfg: S3PortConfig): ObjectStorePort {
  const { client, bucket } = cfg;
  return {
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return res.Body ? await res.Body.transformToString() : null;
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys.sort();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function s3ClientFromEnv(env: NodeJS.ProcessEnv = process.env): S3Client {
  const region = env["AWS_REGION"];
  const endpoint = env["S3_ENDPOINT"]; // set for MinIO / GCS interop
  return new S3Client({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}
