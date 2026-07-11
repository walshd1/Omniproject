import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeTableCell } from "./markdown";

test("escapeTableCell escapes pipes so union types stay in one column", () => {
  assert.equal(escapeTableCell("Promise<Issue | null>"), "Promise<Issue \\| null>");
  assert.equal(escapeTableCell(`op: "create" | "update" | "delete"`), `op: "create" \\| "update" \\| "delete"`);
});

test("escapeTableCell collapses newlines to spaces", () => {
  assert.equal(escapeTableCell("line one\nline two"), "line one line two");
  assert.equal(escapeTableCell("crlf\r\nhere"), "crlf here");
});

test("escapeTableCell leaves pipe-free text untouched", () => {
  assert.equal(escapeTableCell("Promise<void>"), "Promise<void>");
});
