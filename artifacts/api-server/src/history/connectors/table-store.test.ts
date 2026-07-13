import { test } from "node:test";
import assert from "node:assert/strict";
import { tableStoreRetentionSource, type TableItem, type TableStorePort } from "./table-store";
import type { EntitySnapshot, HistoryEntry } from "../types";

/** An in-memory single-table store — sorted by (pk, sk). No DynamoDB SDK. */
function memoryTable(): TableStorePort {
  const items: TableItem[] = [];
  return {
    putItem: async (it) => { items.push(it); },
    query: async (q) => {
      let out = items.filter((it) => it.pk === q.pk && it.sk.startsWith(q.skPrefix));
      if (q.fromSk) out = out.filter((it) => it.sk >= q.fromSk!);
      if (q.toSk) out = out.filter((it) => it.sk < q.toSk!);
      out = out.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
      if (q.descending) out = out.reverse();
      if (q.limit !== undefined) out = out.slice(0, q.limit);
      return out;
    },
    deleteItem: async (pk, sk) => {
      const i = items.findIndex((it) => it.pk === pk && it.sk === sk);
      if (i >= 0) items.splice(i, 1);
    },
    scanAll: async () => [...items],
  };
}

const entry = (field: string, newValue: unknown, changedAt: string): HistoryEntry => ({
  entity: "issue", id: "1", field, oldValue: null, newValue, changedAt, changedBy: "u", txnId: changedAt,
});
const snap = (asOf: string, values: Record<string, unknown>): EntitySnapshot => ({
  entity: "issue", id: "1", asOf, values, provenance: "replayed",
});

test("append + readJournal round-trips within the SK range, time-ordered", async () => {
  const src = tableStoreRetentionSource(memoryTable());
  await src.appendJournal([entry("status", "doing", "2026-02-01T00:00:00Z"), entry("status", "todo", "2026-01-01T00:00:00Z")]);
  const j = await src.readJournal("issue", "1", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" });
  assert.deepEqual(j.map((e) => e.newValue), ["todo", "doing"]);
});

test("readSnapshots returns only the window's snapshots (half-open upper bound)", async () => {
  const src = tableStoreRetentionSource(memoryTable());
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", { percentWorkComplete: 20 }));
  await src.writeSnapshot(snap("2026-02-01T00:00:00Z", { percentWorkComplete: 60 })); // exactly at `to` ⇒ excluded
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]!.values["percentWorkComplete"], 20);
});

test("readSnapshots fans out across multiple ids", async () => {
  const table = memoryTable();
  const src = tableStoreRetentionSource(table);
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-05T00:00:00Z", values: {}, provenance: "replayed" });
  await src.writeSnapshot({ entity: "issue", id: "2", asOf: "2026-01-06T00:00:00Z", values: {}, provenance: "replayed" });
  const snaps = await src.readSnapshots("issue", ["1", "2"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps.length, 2);
});

test("lastSnapshotAt uses a descending limit-1 query", async () => {
  const src = tableStoreRetentionSource(memoryTable());
  assert.equal(await src.lastSnapshotAt("issue", "1"), null);
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", {}));
  await src.writeSnapshot(snap("2026-03-10T00:00:00Z", {}));
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-03-10T00:00:00Z");
});

const jentry = (entity: string, id: string, changedAt: string): HistoryEntry => ({
  entity, id, field: "status", oldValue: null, newValue: "x", changedAt, changedBy: "u", txnId: changedAt,
});
const jsnap = (entity: string, id: string, asOf: string): EntitySnapshot => ({
  entity, id, asOf, values: {}, provenance: "replayed",
});

test("disposeOlderThan prunes stale items across entities but skips legal holds", async () => {
  const t = memoryTable();
  const src = tableStoreRetentionSource(t);
  await src.appendJournal([jentry("issue", "1", "2025-01-01T00:00:00Z"), jentry("issue", "2", "2025-01-01T00:00:00Z"), jentry("issue", "1", "2026-06-01T00:00:00Z")]);
  await src.writeSnapshot(jsnap("issue", "1", "2025-01-01T00:00:00Z"));
  const r = await src.disposeOlderThan!("2026-01-01T00:00:00Z", { heldKeys: ["issue#2"] });
  assert.deepEqual(r, { snapshots: 1, journal: 1 }); // issue#1 2025 snap + journal; issue#2 held
  const remaining = await t.scanAll();
  assert.ok(remaining.some((it) => it.pk === "issue#2"), "held entity kept");
  assert.ok(remaining.some((it) => it.sk.includes("2026-06-01")), "recent kept");
});

test("eraseEntity removes every item for one pk and nothing else", async () => {
  const t = memoryTable();
  const src = tableStoreRetentionSource(t);
  await src.appendJournal([jentry("issue", "1", "2026-01-01T00:00:00Z"), jentry("issue", "2", "2026-01-01T00:00:00Z")]);
  await src.writeSnapshot(jsnap("issue", "1", "2026-01-01T00:00:00Z"));
  const r = await src.eraseEntity!("issue", "1");
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
  const remaining = await t.scanAll();
  assert.ok(!remaining.some((it) => it.pk === "issue#1"), "erased pk gone");
  assert.ok(remaining.some((it) => it.pk === "issue#2"), "other pk untouched");
});
