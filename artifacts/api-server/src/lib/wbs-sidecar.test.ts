import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env["OMNI_CONFIG_DIR"] ??= fs.mkdtempSync(path.join(os.tmpdir(), "wbs-sidecar-"));
const { getSidecarWbs, hasSidecarWbs, setSidecarWbs, upsertSidecarWbsRow } = await import("./wbs-sidecar");

/**
 * The sidecar WBS store (§4.6, path 3): OmniProject's own sealed home for WBS records — the all-in-one model.
 * Round-trips raw rows, upserts field-by-field (merge), and cleans forbidden keys before sealing.
 */

after(() => { try { fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); } catch { /* noop */ } });

test("empty until authored; setSidecarWbs round-trips rows", () => {
  const pid = "p-sc-1";
  assert.equal(hasSidecarWbs(pid), false);
  setSidecarWbs(pid, [{ id: "A", name: "Root", budget: 100 }]);
  assert.equal(hasSidecarWbs(pid), true);
  assert.deepEqual(getSidecarWbs(pid), [{ id: "A", name: "Root", budget: 100 }]);
});

test("upsert merges by id (a partial write leaves the rest intact) and appends new ids", () => {
  const pid = "p-sc-2";
  upsertSidecarWbsRow(pid, "id", "A", { name: "Root", budget: 500 });
  upsertSidecarWbsRow(pid, "id", "A", { actual: 200 });      // partial — keeps name + budget
  upsertSidecarWbsRow(pid, "id", "B", { name: "Child" });
  const rows = getSidecarWbs(pid);
  const a = rows.find((r) => r["id"] === "A")!;
  assert.deepEqual(a, { id: "A", name: "Root", budget: 500, actual: 200 });
  assert.ok(rows.some((r) => r["id"] === "B"));
});

test("forbidden keys are stripped before sealing (defence in depth)", () => {
  const pid = "p-sc-3";
  setSidecarWbs(pid, [JSON.parse('{"id":"A","__proto__":"x","name":"ok"}')]);
  const row = getSidecarWbs(pid)[0]!;
  assert.equal(row["name"], "ok");
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "__proto__"));
});
