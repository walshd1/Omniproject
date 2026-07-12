import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleByInstance } from "./assemble";
import type { Project } from "./types";

const p = (over: Partial<Project>): Project => ({ id: "x", name: "P", ...over });

test("assembles rows from different backends that share an omniInstanceId into one entity", () => {
  const rows: Project[] = [
    p({ id: "proj-1", source: "jira", omniInstanceId: "guid-A", name: "Apollo (Jira)" }),
    p({ id: "PRJ-9", source: "sql", omniInstanceId: "guid-A", name: "Apollo (ERP)", budget: 1000 }),
    p({ id: "proj-2", source: "jira", omniInstanceId: "guid-B", name: "Zephyr" }),
  ];
  const out = assembleByInstance(rows);
  assert.equal(out.length, 2); // two real projects
  const apollo = out.find((e) => e.key === "guid-A")!;
  assert.equal(apollo.count, 2); // spanned two backends
  assert.equal(apollo.records.length, 2); // per-source rows retained (provenance kept)
  assert.equal(apollo.merged["budget"], 1000); // field present in only one backend survives the merge
});

test("a row with no correlation GUID stands alone (never merged)", () => {
  const rows: Project[] = [
    p({ id: "a", omniInstanceId: "guid-A" }),
    p({ id: "b" }), // no GUID
    p({ id: "c" }), // no GUID
  ];
  const out = assembleByInstance(rows);
  assert.equal(out.length, 3); // the two GUID-less rows are NOT merged together
  assert.ok(out.every((e) => e.count === 1));
});
