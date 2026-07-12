import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryArchiveStore, selectArchiveStore, type ArchivedProject } from "./archive-store";

const SNAP: ArchivedProject = {
  guid: "guid-1", archivedAt: "2026-07-12T00:00:00Z",
  project: { id: "proj-9", name: "Apollo", omniInstanceId: "guid-1" },
  issues: [{ id: "iss-1", projectId: "proj-9", title: "Cutover", status: "done" }],
  note: "Q3 decommission",
};

test("MemoryArchiveStore round-trips a snapshot and lists the index", async () => {
  const s = new MemoryArchiveStore();
  assert.deepEqual(await s.list(), []);
  await s.save(SNAP);
  const got = await s.get("guid-1");
  assert.equal(got?.project["name"], "Apollo");
  assert.equal(got?.issues.length, 1);
  assert.deepEqual(await s.list(), [{ guid: "guid-1", archivedAt: "2026-07-12T00:00:00Z" }]);
  assert.equal(await s.get("nope"), null);
});

test("selectArchiveStore defaults to memory; a sidecar without a URL falls back to memory", () => {
  const prevStore = process.env["ARCHIVE_STORE"];
  const prevUrl = process.env["SQL_SIDECAR_URL"];
  try {
    delete process.env["ARCHIVE_STORE"]; delete process.env["SQL_SIDECAR_URL"];
    assert.equal(selectArchiveStore().name, "memory");
    process.env["ARCHIVE_STORE"] = "sidecar"; // no SQL_SIDECAR_URL → must fall back, never pretend to persist
    assert.equal(selectArchiveStore().name, "memory");
    process.env["SQL_SIDECAR_URL"] = "https://sidecar.internal";
    assert.equal(selectArchiveStore().name, "sidecar");
  } finally {
    if (prevStore === undefined) delete process.env["ARCHIVE_STORE"]; else process.env["ARCHIVE_STORE"] = prevStore;
    if (prevUrl === undefined) delete process.env["SQL_SIDECAR_URL"]; else process.env["SQL_SIDECAR_URL"] = prevUrl;
  }
});
