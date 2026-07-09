import { test } from "node:test";
import assert from "node:assert/strict";
import type { S3Client } from "@aws-sdk/client-s3";
import { s3ObjectStorePort } from "./s3";
import { objectStoreRetentionSource } from "../contract";

/** A fake S3Client.send over an in-memory bucket — inspects the command type + input. */
function fakeS3(seed: Record<string, string> = {}): S3Client {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const kind = command.constructor.name;
      const inp = command.input;
      if (kind === "PutObjectCommand") {
        store.set(String(inp["Key"]), String(inp["Body"]));
        return {};
      }
      if (kind === "GetObjectCommand") {
        const key = String(inp["Key"]);
        if (!store.has(key)) throw Object.assign(new Error("no key"), { name: "NoSuchKey" });
        const body = store.get(key)!;
        return { Body: { transformToString: async () => body } };
      }
      if (kind === "ListObjectsV2Command") {
        const prefix = String(inp["Prefix"] ?? "");
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error(`unexpected command ${kind}`);
    },
  } as unknown as S3Client;
}

test("put/get round-trips; get on a missing key returns null (NoSuchKey → null)", async () => {
  const port = s3ObjectStorePort({ client: fakeS3(), bucket: "b" });
  assert.equal(await port.get("missing"), null);
  await port.put("k1", "hello");
  assert.equal(await port.get("k1"), "hello");
});

test("list returns sorted keys under the prefix", async () => {
  const port = s3ObjectStorePort({ client: fakeS3({ "a/2": "x", "a/1": "y", "b/1": "z" }), bucket: "b" });
  assert.deepEqual(await port.list("a/"), ["a/1", "a/2"]);
});

test("the S3 port drives the shared connector end-to-end (snapshot round-trip)", async () => {
  const src = objectStoreRetentionSource(s3ObjectStorePort({ client: fakeS3(), bucket: "b" }));
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: { percentWorkComplete: 30 }, provenance: "replayed" });
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]!.values["percentWorkComplete"], 30);
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-01-10T00:00:00Z");
});
