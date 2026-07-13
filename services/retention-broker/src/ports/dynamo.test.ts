import { test } from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { dynamoTableStorePort } from "./dynamo";
import { tableStoreRetentionSource } from "../contract";

/** A fake DocumentClient.send over an in-memory item list — handles Put + Query (begins_with/BETWEEN). */
function fakeDoc(): DynamoDBDocumentClient {
  const items: { pk: string; sk: string; data: unknown }[] = [];
  return {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const kind = command.constructor.name;
      const inp = command.input;
      if (kind === "PutCommand") {
        const it = inp["Item"] as { pk: string; sk: string; data: unknown };
        items.push({ pk: it.pk, sk: it.sk, data: it.data });
        return {};
      }
      if (kind === "QueryCommand") {
        const vals = inp["ExpressionAttributeValues"] as Record<string, string>;
        const cond = String(inp["KeyConditionExpression"]);
        let out = items.filter((i) => i.pk === vals[":pk"]);
        if (cond.includes("BETWEEN")) out = out.filter((i) => i.sk >= vals[":from"]! && i.sk <= vals[":to"]!);
        else out = out.filter((i) => i.sk.startsWith(vals[":pre"]!));
        out = out.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
        if (inp["ScanIndexForward"] === false) out = out.reverse();
        if (inp["Limit"] !== undefined) out = out.slice(0, Number(inp["Limit"]));
        return { Items: out };
      }
      if (kind === "ScanCommand") {
        return { Items: [...items] };
      }
      if (kind === "DeleteCommand") {
        const key = inp["Key"] as { pk: string; sk: string };
        const i = items.findIndex((it) => it.pk === key.pk && it.sk === key.sk);
        if (i >= 0) items.splice(i, 1);
        return {};
      }
      throw new Error(`unexpected command ${kind}`);
    },
  } as unknown as DynamoDBDocumentClient;
}

test("the Dynamo port drives the shared connector: snapshot window + lastSnapshotAt", async () => {
  const src = tableStoreRetentionSource(dynamoTableStorePort({ doc: fakeDoc(), table: "t" }));
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: { percentWorkComplete: 20 }, provenance: "replayed" });
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-03-10T00:00:00Z", values: { percentWorkComplete: 80 }, provenance: "replayed" });
  const jan = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(jan.length, 1);
  assert.equal(jan[0]!.values["percentWorkComplete"], 20);
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-03-10T00:00:00Z");
});

test("journal append + read via the Dynamo port round-trips time-ordered", async () => {
  const src = tableStoreRetentionSource(dynamoTableStorePort({ doc: fakeDoc(), table: "t" }));
  await src.appendJournal([
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "doing", changedAt: "2026-02-01T00:00:00Z", changedBy: "u", txnId: "b" },
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "todo", changedAt: "2026-01-01T00:00:00Z", changedBy: "u", txnId: "a" },
  ]);
  const j = await src.readJournal("issue", "1", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" });
  assert.deepEqual(j.map((e) => e.newValue), ["todo", "doing"]);
});

test("the Dynamo port disposes stale items (scan+delete) but skips legal holds", async () => {
  const src = tableStoreRetentionSource(dynamoTableStorePort({ doc: fakeDoc(), table: "t" }));
  await src.appendJournal([
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2025-01-01T00:00:00Z", changedBy: "u", txnId: "a" },
    { entity: "issue", id: "2", field: "status", oldValue: null, newValue: "x", changedAt: "2025-01-01T00:00:00Z", changedBy: "u", txnId: "b" },
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2026-06-01T00:00:00Z", changedBy: "u", txnId: "c" },
  ]);
  const r = await src.disposeOlderThan!("2026-01-01T00:00:00Z", { heldKeys: ["issue#2"] });
  assert.deepEqual(r, { snapshots: 0, journal: 1 });
  assert.equal((await src.readJournal("issue", "2", { from: "2020-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" })).length, 1, "held kept");
});

test("the Dynamo port erases every item for one entity id", async () => {
  const src = tableStoreRetentionSource(dynamoTableStorePort({ doc: fakeDoc(), table: "t" }));
  await src.appendJournal([
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2026-01-01T00:00:00Z", changedBy: "u", txnId: "a" },
    { entity: "issue", id: "2", field: "status", oldValue: null, newValue: "x", changedAt: "2026-01-01T00:00:00Z", changedBy: "u", txnId: "b" },
  ]);
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-01T00:00:00Z", values: {}, provenance: "replayed" });
  const r = await src.eraseEntity!("issue", "1");
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
  assert.equal((await src.readJournal("issue", "1", { from: "2020-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" })).length, 0, "erased");
  assert.equal((await src.readJournal("issue", "2", { from: "2020-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" })).length, 1, "other kept");
});
