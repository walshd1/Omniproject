import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "./csv";

test("toCsv builds a BOM-prefixed, CRLF, RFC-4180-quoted document", () => {
  const csv = toCsv(["Name", "Note"], [["A, Inc", 'say "hi"'], ["plain", "x"]]);
  assert.ok(csv.startsWith("﻿"), "has a UTF-8 BOM");
  const rows = csv.replace("﻿", "").split("\r\n");
  assert.equal(rows[0], "Name,Note");
  assert.equal(rows[1], '"A, Inc","say ""hi"""');
  assert.equal(rows[2], "plain,x");
});

test("toCsv neutralises CSV-injection formula triggers (= + - @ tab CR)", () => {
  const csv = toCsv(["v"], [["=1+1"], ["+x"], ["-x"], ["@x"], ["\tx"], ["safe"], ["a=b"]]);
  const cells = csv.replace("﻿", "").split("\r\n").slice(1);
  // Leading triggers are prefixed with an apostrophe so Excel/Sheets won't run them.
  assert.equal(cells[0], "'=1+1");
  assert.equal(cells[1], "'+x");
  assert.equal(cells[2], "'-x");
  assert.equal(cells[3], "'@x");
  assert.ok(cells[4]!.startsWith("'"), "leading tab is guarded");
  // A non-leading trigger and a plain value are untouched.
  assert.equal(cells[5], "safe");
  assert.equal(cells[6], "a=b");
});

test("toCsv coerces null/undefined/number cells", () => {
  const csv = toCsv(["a", "b", "c"], [[null, undefined, 42]]);
  assert.equal(csv.replace("﻿", "").split("\r\n")[1], ",,42");
});
