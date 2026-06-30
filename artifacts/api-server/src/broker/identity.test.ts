import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifyId, qualifiedId, stampSource } from "./identity";
import type { Row } from "./types";

test("qualifyId builds a source-qualified key, falling back to the raw id when no source", () => {
  assert.equal(qualifyId("jira", "proj-1"), "jira:proj-1");
  assert.equal(qualifyId("", "proj-1"), "proj-1");
  assert.equal(qualifyId(null, "proj-1"), "proj-1");
});

test("two backends minting the same id stay distinct once qualified", () => {
  const a: Row = { id: "100", name: "Migration", source: "jira" };
  const b: Row = { id: "100", name: "Migration", source: "azure-devops" };
  assert.notEqual(qualifiedId(a), qualifiedId(b)); // same id + same name, different source → distinct
  assert.equal(qualifiedId(a), "jira:100");
});

test("qualifiedId uses a fallback source when the row omitted one", () => {
  assert.equal(qualifiedId({ id: "7" } as Row, "plane"), "plane:7");
});

test("stampSource fills source only where missing, leaving backend-supplied source intact", () => {
  const rows: Row[] = [{ id: "1" }, { id: "2", source: "jira" }, { id: "3", source: "" }];
  stampSource(rows, "plane");
  assert.equal(rows[0]!["source"], "plane"); // was missing → stamped
  assert.equal(rows[1]!["source"], "jira"); // already set → untouched
  assert.equal(rows[2]!["source"], "plane"); // empty string → stamped
});
