import { test } from "node:test";
import assert from "node:assert/strict";
import { warehouseRetentionSource, type WarehousePort, type WarehouseQuery } from "./warehouse";
import type { EntitySnapshot, HistoryEntry } from "../types";

/** An in-memory warehouse — two row arrays + a tiny query interpreter for the connector's SQL. No BigQuery SDK. */
function memoryWarehouse(): WarehousePort & { rows: Record<string, Record<string, unknown>[]> } {
  const rows: Record<string, Record<string, unknown>[]> = { journal: [], snapshot: [] };
  return {
    rows,
    insertRows: async (table, rs) => { rows[table]!.push(...rs); },
    query: async (q: WarehouseQuery) => {
      const p = q.params;
      // Interpret only the shapes this connector emits (entity/id/window/ids), honouring bound params.
      const table = q.sql.includes("FROM snapshot") ? "snapshot" : "journal";
      let out = rows[table]!.filter((r) => r["entity"] === p["entity"]);
      if ("id" in p) out = out.filter((r) => r["id"] === p["id"]);
      if ("ids" in p) out = out.filter((r) => (p["ids"] as string[]).includes(String(r["id"])));
      const col = table === "snapshot" ? "as_of" : "changed_at";
      if ("from" in p) out = out.filter((r) => String(r[col]) >= String(p["from"]));
      if ("to" in p) out = out.filter((r) => String(r[col]) < String(p["to"]));
      out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
      if (q.sql.includes("DESC")) out = out.reverse();
      if (q.sql.includes("LIMIT 1")) out = out.slice(0, 1);
      return out;
    },
    execute: async (q: WarehouseQuery) => {
      // Interpret the two DELETE shapes the connector emits: erase (entity+id) and dispose (cutoff + held).
      const p = q.params;
      const table = q.sql.includes("FROM snapshot") ? "snapshot" : "journal";
      const col = table === "snapshot" ? "as_of" : "changed_at";
      const before = rows[table]!.length;
      const held = new Set(((p["held"] as string[] | undefined) ?? []).map(String));
      rows[table] = rows[table]!.filter((r) => {
        if ("cutoff" in p) {
          const stale = String(r[col]) < String(p["cutoff"]);
          const isHeld = held.has(`${String(r["entity"])}#${String(r["id"])}`);
          return !(stale && !isHeld); // keep unless stale-and-not-held
        }
        // erase: keep unless entity+id match
        return !(r["entity"] === p["entity"] && r["id"] === p["id"]);
      });
      return { rowsAffected: before - rows[table]!.length };
    },
  };
}

const entry = (field: string, newValue: unknown, changedAt: string): HistoryEntry => ({
  entity: "issue", id: "1", field, oldValue: null, newValue, changedAt, changedBy: "u", txnId: changedAt,
});
const snap = (asOf: string, values: Record<string, unknown>): EntitySnapshot => ({
  entity: "issue", id: "1", asOf, values, provenance: "replayed",
});

test("snapshots insert as rows with JSON values and read back parsed", async () => {
  const wh = memoryWarehouse();
  const src = warehouseRetentionSource(wh);
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", { percentWorkComplete: 20 }));
  assert.equal(typeof wh.rows["snapshot"]![0]!["values"], "string", "values stored as JSON text");
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps[0]!.values["percentWorkComplete"], 20);
});

test("readSnapshots honours the window and id set (bound @params)", async () => {
  const src = warehouseRetentionSource(memoryWarehouse());
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", { percentWorkComplete: 20 }));
  await src.writeSnapshot(snap("2026-03-10T00:00:00Z", { percentWorkComplete: 90 }));
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps.length, 1);
});

test("readSnapshots with an empty id set is a no-op (no query)", async () => {
  const src = warehouseRetentionSource(memoryWarehouse());
  assert.deepEqual(await src.readSnapshots("issue", [], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }), []);
});

test("append + readJournal round-trips with parsed old/new values", async () => {
  const src = warehouseRetentionSource(memoryWarehouse());
  await src.appendJournal([entry("labels", ["a", "b"], "2026-01-05T00:00:00Z")]);
  const j = await src.readJournal("issue", "1", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.deepEqual(j[0]!.newValue, ["a", "b"]);
});

test("lastSnapshotAt returns the newest as_of or null", async () => {
  const src = warehouseRetentionSource(memoryWarehouse());
  assert.equal(await src.lastSnapshotAt("issue", "1"), null);
  await src.writeSnapshot(snap("2026-01-10T00:00:00Z", {}));
  await src.writeSnapshot(snap("2026-03-10T00:00:00Z", {}));
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-03-10T00:00:00Z");
});

const wentry = (entity: string, id: string, changedAt: string): HistoryEntry => ({
  entity, id, field: "status", oldValue: null, newValue: "x", changedAt, changedBy: "u", txnId: changedAt,
});
const wsnap = (entity: string, id: string, asOf: string): EntitySnapshot => ({
  entity, id, asOf, values: {}, provenance: "replayed",
});

test("disposeOlderThan DELETEs rows older than the cutoff, excluding legal holds", async () => {
  const wh = memoryWarehouse();
  const src = warehouseRetentionSource(wh);
  await src.appendJournal([wentry("issue", "1", "2025-01-01T00:00:00Z"), wentry("issue", "2", "2025-01-01T00:00:00Z"), wentry("issue", "1", "2026-06-01T00:00:00Z")]);
  await src.writeSnapshot(wsnap("issue", "1", "2025-01-01T00:00:00Z"));
  const r = await src.disposeOlderThan!("2026-01-01T00:00:00Z", { heldKeys: ["issue#2"] });
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
  assert.ok(wh.rows["journal"]!.some((row) => row["id"] === "2"), "held entity kept");
  assert.ok(wh.rows["journal"]!.some((row) => row["changed_at"] === "2026-06-01T00:00:00Z"), "recent kept");
});

test("eraseEntity DELETEs all rows for one entity id", async () => {
  const wh = memoryWarehouse();
  const src = warehouseRetentionSource(wh);
  await src.appendJournal([wentry("issue", "1", "2026-01-01T00:00:00Z"), wentry("issue", "2", "2026-01-01T00:00:00Z")]);
  await src.writeSnapshot(wsnap("issue", "1", "2026-01-01T00:00:00Z"));
  const r = await src.eraseEntity!("issue", "1");
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
  assert.ok(!wh.rows["journal"]!.some((row) => row["id"] === "1"), "erased id gone");
  assert.ok(wh.rows["journal"]!.some((row) => row["id"] === "2"), "other id kept");
});
