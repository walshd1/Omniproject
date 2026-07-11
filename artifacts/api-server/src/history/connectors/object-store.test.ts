import { test } from "node:test";
import assert from "node:assert/strict";
import { objectStoreRetentionSource, type ObjectStorePort } from "./object-store";
import type { EntitySnapshot, HistoryEntry } from "../types";

/** An in-memory object store — a Map keyed by object key. No AWS SDK. */
function memoryStore(): ObjectStorePort & { keys: () => string[] } {
  const m = new Map<string, string>();
  return {
    keys: () => [...m.keys()],
    put: async (k, b) => { m.set(k, b); },
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const entry = (field: string, newValue: unknown, changedAt: string): HistoryEntry => ({
  entity: "issue", id: "1", field, oldValue: null, newValue, changedAt, changedBy: "u", txnId: changedAt,
});
const snap = (asOf: string, values: Record<string, unknown>): EntitySnapshot => ({
  entity: "issue", id: "1", asOf, values, provenance: "replayed",
});

test("append + readJournal round-trips within a window, time-ordered", async () => {
  const store = memoryStore();
  const src = objectStoreRetentionSource(store);
  await src.appendJournal([entry("status", "doing", "2026-02-01T00:00:00Z"), entry("status", "todo", "2026-01-01T00:00:00Z")]);
  const j = await src.readJournal("issue", "1", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" });
  assert.deepEqual(j.map((e) => e.newValue), ["todo", "doing"]);
});

test("readJournal excludes entries outside the window", async () => {
  const store = memoryStore();
  const src = objectStoreRetentionSource(store);
  await src.appendJournal([entry("status", "old", "2025-01-01T00:00:00Z"), entry("status", "new", "2026-02-01T00:00:00Z")]);
  const j = await src.readJournal("issue", "1", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" });
  assert.deepEqual(j.map((e) => e.newValue), ["new"]);
});

test("writeSnapshot + readSnapshots returns snapshots in the window", async () => {
  const store = memoryStore();
  const src = objectStoreRetentionSource(store);
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", { percentWorkComplete: 20 }));
  await src.writeSnapshot(snap("2026-02-10T00:00:00Z", { percentWorkComplete: 60 }));
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]!.values["percentWorkComplete"], 20);
});

test("lastSnapshotAt returns the most recent as-of (lexical max), or null when none", async () => {
  const store = memoryStore();
  const src = objectStoreRetentionSource(store);
  assert.equal(await src.lastSnapshotAt("issue", "1"), null);
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", {}));
  await src.writeSnapshot(snap("2026-03-10T00:00:00Z", {}));
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-03-10T00:00:00Z");
});

test("journal objects are immutable/append-only — one unique key per field change", async () => {
  const store = memoryStore();
  const src = objectStoreRetentionSource(store);
  await src.appendJournal([entry("status", "a", "2026-01-01T00:00:00Z"), entry("budget", 5, "2026-01-01T00:00:00Z")]);
  assert.equal(store.keys().filter((k) => k.startsWith("journal/")).length, 2);
});
