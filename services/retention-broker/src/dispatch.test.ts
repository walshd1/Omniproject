import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch, isOp, OPS } from "./dispatch";
import type { RetentionSource, EntitySnapshot, HistoryEntry } from "./contract";

/** A recording in-memory source to assert the dispatcher maps ops → the right calls with the right args. */
function recordingSource(): RetentionSource & { calls: { op: string; args: unknown[] }[] } {
  const calls: { op: string; args: unknown[] }[] = [];
  const snap: EntitySnapshot = { entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: {}, provenance: "replayed" };
  return {
    calls,
    readSnapshots: async (...a) => { calls.push({ op: "readSnapshots", args: a }); return [snap]; },
    readJournal: async (...a) => { calls.push({ op: "readJournal", args: a }); return []; },
    appendJournal: async (...a) => { calls.push({ op: "appendJournal", args: a }); },
    writeSnapshot: async (...a) => { calls.push({ op: "writeSnapshot", args: a }); },
    lastSnapshotAt: async (...a) => { calls.push({ op: "lastSnapshotAt", args: a }); return "2026-01-10T00:00:00Z"; },
  };
}

test("OPS/isOp define the wire contract", () => {
  assert.equal(OPS.length, 5);
  assert.ok(isOp("read-snapshots"));
  assert.ok(!isOp("delete-everything"));
});

test("read-snapshots maps entity/ids/window to readSnapshots", async () => {
  const s = recordingSource();
  const window = { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" };
  const out = await dispatch(s, "read-snapshots", { entity: "issue", ids: ["1", "2"], window });
  assert.deepEqual(s.calls[0], { op: "readSnapshots", args: ["issue", ["1", "2"], window] });
  assert.equal((out as EntitySnapshot[]).length, 1);
});

test("append-journal + write-snapshot return {ok:true} and pass the payload through", async () => {
  const s = recordingSource();
  const entries: HistoryEntry[] = [{ entity: "issue", id: "1", field: "status", oldValue: null, newValue: "todo", changedAt: "2026-01-05T09:30:00Z", changedBy: null, txnId: "x" }];
  assert.deepEqual(await dispatch(s, "append-journal", { entries }), { ok: true });
  assert.deepEqual(s.calls[0]!.args[0], entries);
  assert.deepEqual(await dispatch(s, "write-snapshot", { snapshot: { entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: {}, provenance: "replayed" } }), { ok: true });
});

test("last-snapshot-at wraps the result as {asOf}", async () => {
  const s = recordingSource();
  assert.deepEqual(await dispatch(s, "last-snapshot-at", { entity: "issue", id: "1" }), { asOf: "2026-01-10T00:00:00Z" });
});
