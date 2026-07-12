import { test } from "node:test";
import assert from "node:assert/strict";
import { liveProjectsOnly } from "./data";
import { MemoryStore } from "../broker/builtin/store";
import type { Row } from "../broker/types";

test("liveProjectsOnly drops closed projects, keeps live + statusless ones", () => {
  const rows: Row[] = [
    { id: "a", name: "Active", status: "active" },
    { id: "b", name: "OnHold", status: "On Hold" },
    { id: "c", name: "Done", status: "completed" },
    { id: "d", name: "Archived", status: "archived" },
    { id: "e", name: "Cancelled", status: "cancelled" },
    { id: "f", name: "NoStatus" }, // absent ⇒ live
  ];
  const live = liveProjectsOnly(rows).map((r) => r["id"]);
  assert.deepEqual(live, ["a", "b", "f"]);
});

test("the built-in store persists project status, and the filter reads it end-to-end", async () => {
  const store = new MemoryStore();
  await store.createProject({ name: "Live one" }); // no status → demo/default absent ⇒ live
  await store.createProject({ name: "Shelved", status: "archived" });
  const all = await store.listProjects();
  assert.equal(all.length, 2); // the store itself keeps everything
  const live = liveProjectsOnly(all as unknown as Row[]);
  assert.equal(live.length, 1);
  assert.equal(live[0]!["name"], "Live one"); // the archived project is filtered from a default read
});
