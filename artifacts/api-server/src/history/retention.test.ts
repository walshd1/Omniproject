import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrend,
  recordWrite,
  registerRetentionProvider,
  resetRetentionProvider,
  retentionSourceFor,
  type RetentionSource,
} from "./retention";
import type { EntitySnapshot, HistoryEntry, TimeWindow } from "./types";

/** A hand-built in-memory retention source — no SQL, no self-host DB. */
function memorySource(seedSnapshots: EntitySnapshot[] = []): RetentionSource & {
  journal: HistoryEntry[];
  snapshots: EntitySnapshot[];
} {
  const journal: HistoryEntry[] = [];
  const snapshots: EntitySnapshot[] = [...seedSnapshots];
  return {
    journal,
    snapshots,
    readSnapshots: async (entity, ids, w: TimeWindow) =>
      snapshots.filter((s) => s.entity === entity && ids.includes(s.id) && s.asOf >= w.from && s.asOf < w.to),
    readJournal: async (entity, id, w) => journal.filter((e) => e.entity === entity && e.id === id && e.changedAt >= w.from && e.changedAt < w.to),
    appendJournal: async (entries) => { journal.push(...entries); },
    writeSnapshot: async (s) => { snapshots.push(s); },
    lastSnapshotAt: async (entity, id) => {
      const mine = snapshots.filter((s) => s.entity === entity && s.id === id);
      return mine.length ? mine[mine.length - 1]!.asOf : null;
    },
  };
}

afterEach(resetRetentionProvider);

test("with no provider registered, buildTrend returns an honest unavailable series", async () => {
  const s = await buildTrend("issue", ["1"], "completionPct", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "month");
  assert.equal(s.available, false);
  assert.ok(s.reason);
});

test("a registered provider feeds computeSeries from its snapshots", async () => {
  const src = memorySource([
    { entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: { percentWorkComplete: 30 }, provenance: "replayed" },
  ]);
  registerRetentionProvider(() => src);
  const s = await buildTrend("issue", ["1"], "completionPct", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "month");
  assert.equal(s.available, true);
  assert.equal(s.points[0]!.value, 30);
});

test("retentionSourceFor returns the provider's source (or null)", () => {
  assert.equal(retentionSourceFor(), null);
  const src = memorySource();
  registerRetentionProvider(() => src);
  assert.equal(retentionSourceFor(), src);
});

test("recordWrite journals the diff and snapshots when the cadence is due (onWrite)", async () => {
  const src = memorySource();
  const meta = { changedAt: "2026-01-01T00:00:00Z", changedBy: "u1", txnId: "t1" };
  const res = await recordWrite(src, "issue", "1", { status: "todo" }, { status: "doing", percentWorkComplete: 40 }, meta, { kind: "onWrite" });
  assert.equal(res.journalled, 2);
  assert.equal(res.snapshotted, true);
  assert.equal(src.snapshots.length, 1);
  assert.equal(src.snapshots[0]!.values["status"], "doing");
  assert.equal(src.snapshots[0]!.values["percentWorkComplete"], 40);
});

test("recordWrite with manual cadence journals but never auto-snapshots", async () => {
  const src = memorySource();
  const meta = { changedAt: "2026-01-01T00:00:00Z", changedBy: null, txnId: "t2" };
  const res = await recordWrite(src, "issue", "1", {}, { title: "New" }, meta, { kind: "manual" });
  assert.equal(res.journalled, 1);
  assert.equal(res.snapshotted, false);
  assert.equal(src.snapshots.length, 0);
});

test("recordWrite is a no-op when nothing changed", async () => {
  const src = memorySource();
  const meta = { changedAt: "2026-01-01T00:00:00Z", changedBy: null, txnId: "t3" };
  const res = await recordWrite(src, "issue", "1", { title: "Same" }, { title: "Same" }, meta, { kind: "onWrite" });
  assert.equal(res.journalled, 0);
  assert.equal(res.snapshotted, false);
});
