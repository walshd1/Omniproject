import { test } from "node:test";
import assert from "node:assert/strict";
import { bigQueryWarehousePort, type BigQueryLike } from "./bigquery";
import { warehouseRetentionSource } from "../contract";

/** A fake BigQuery over in-memory row tables — interprets the connector's parameterised SQL. */
function fakeBigQuery(): BigQueryLike & { qualified: string[] } {
  const rows: Record<string, Record<string, unknown>[]> = { journal: [], snapshot: [] };
  const qualified: string[] = [];
  return {
    qualified,
    dataset: (_id) => ({
      table: (name) => ({
        insert: async (rs: Record<string, unknown>[]) => {
          rows[name]!.push(...rs);
        },
      }),
    }),
    query: async (opts) => {
      qualified.push(opts.query); // capture so we can assert the table was dataset-qualified
      const p = opts.params ?? {};
      const table = opts.query.includes(".snapshot`") ? "snapshot" : "journal";
      const col = table === "snapshot" ? "as_of" : "changed_at";
      let out = rows[table]!.filter((r) => r["entity"] === p["entity"]);
      if ("id" in p) out = out.filter((r) => r["id"] === p["id"]);
      if ("ids" in p) out = out.filter((r) => (p["ids"] as string[]).includes(String(r["id"])));
      if ("from" in p) out = out.filter((r) => String(r[col]) >= String(p["from"]));
      if ("to" in p) out = out.filter((r) => String(r[col]) < String(p["to"]));
      out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
      if (opts.query.includes("DESC")) out = out.reverse();
      if (opts.query.includes("LIMIT 1")) out = out.slice(0, 1);
      return [out];
    },
    createQueryJob: async (opts) => {
      qualified.push(opts.query);
      const p = opts.params ?? {};
      const table = opts.query.includes(".snapshot`") ? "snapshot" : "journal";
      const col = table === "snapshot" ? "as_of" : "changed_at";
      const before = rows[table]!.length;
      const held = new Set(((p["held"] as string[] | undefined) ?? []).map(String));
      rows[table] = rows[table]!.filter((r) => {
        if ("cutoff" in p) {
          const stale = String(r[col]) < String(p["cutoff"]);
          const isHeld = held.has(`${String(r["entity"])}#${String(r["id"])}`);
          return !(stale && !isHeld); // keep unless stale-and-not-held
        }
        return !(r["entity"] === p["entity"] && r["id"] === p["id"]); // erase: drop entity+id matches
      });
      const affected = before - rows[table]!.length;
      const job = {
        getQueryResults: async () => [[]] as [Record<string, unknown>[]],
        getMetadata: async () => [{ statistics: { query: { numDmlAffectedRows: affected } } }] as [{ statistics: { query: { numDmlAffectedRows: number } } }],
      };
      return [job];
    },
  };
}

test("the BigQuery port drives the shared connector and dataset-qualifies the table", async () => {
  const bq = fakeBigQuery();
  const src = warehouseRetentionSource(bigQueryWarehousePort({ bq, dataset: "omni" }));
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: { percentWorkComplete: 30 }, provenance: "replayed" });
  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps[0]!.values["percentWorkComplete"], 30);
  assert.ok(bq.qualified.some((q) => q.includes("`omni.snapshot`")), "FROM snapshot rewritten to `omni.snapshot`");
});

test("lastSnapshotAt via the BigQuery port returns the newest as_of", async () => {
  const src = warehouseRetentionSource(bigQueryWarehousePort({ bq: fakeBigQuery(), dataset: "omni" }));
  assert.equal(await src.lastSnapshotAt("issue", "1"), null);
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: {}, provenance: "replayed" });
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-03-10T00:00:00Z", values: {}, provenance: "replayed" });
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-03-10T00:00:00Z");
});

test("disposeOlderThan via the BigQuery port runs qualified DML and reports affected rows", async () => {
  const bq = fakeBigQuery();
  const src = warehouseRetentionSource(bigQueryWarehousePort({ bq, dataset: "omni" }));
  await src.appendJournal([
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2025-01-01T00:00:00Z", changedBy: "u", txnId: "a" },
    { entity: "issue", id: "2", field: "status", oldValue: null, newValue: "x", changedAt: "2025-01-01T00:00:00Z", changedBy: "u", txnId: "b" },
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2026-06-01T00:00:00Z", changedBy: "u", txnId: "c" },
  ]);
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2025-01-01T00:00:00Z", values: {}, provenance: "replayed" });
  const r = await src.disposeOlderThan!("2026-01-01T00:00:00Z", { heldKeys: ["issue#2"] });
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
  assert.ok(bq.qualified.some((q) => q.includes("DELETE") && q.includes("`omni.journal`")), "DELETE dataset-qualified");
});

test("eraseEntity via the BigQuery port deletes one entity id across both tables", async () => {
  const bq = fakeBigQuery();
  const src = warehouseRetentionSource(bigQueryWarehousePort({ bq, dataset: "omni" }));
  await src.appendJournal([
    { entity: "issue", id: "1", field: "status", oldValue: null, newValue: "x", changedAt: "2026-01-01T00:00:00Z", changedBy: "u", txnId: "a" },
    { entity: "issue", id: "2", field: "status", oldValue: null, newValue: "x", changedAt: "2026-01-01T00:00:00Z", changedBy: "u", txnId: "b" },
  ]);
  await src.writeSnapshot({ entity: "issue", id: "1", asOf: "2026-01-01T00:00:00Z", values: {}, provenance: "replayed" });
  const r = await src.eraseEntity!("issue", "1");
  assert.deepEqual(r, { snapshots: 1, journal: 1 });
});
