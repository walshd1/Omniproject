import { test } from "node:test";
import assert from "node:assert/strict";
import { createAsserter, green, red, bold } from "./assert";

test("color helpers wrap text in the matching ANSI escape and reset", () => {
  assert.equal(green("ok"), "\x1b[32mok\x1b[0m");
  assert.equal(red("no"), "\x1b[31mno\x1b[0m");
  assert.equal(bold("hi"), "\x1b[1mhi\x1b[0m");
});

test("createAsserter tallies passes and failures independently", () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  try {
    const a = createAsserter();
    assert.equal(a.pass, 0);
    assert.equal(a.fail, 0);

    a.assert("first", true);
    a.assert("second", true);
    a.assert("third", false);
    a.assert("fourth", false, "because reasons");

    assert.equal(a.pass, 2);
    assert.equal(a.fail, 2);
  } finally {
    console.log = orig;
  }

  // passing rows show a check, failing rows show a cross; the detail is appended.
  assert.ok(logs[0]!.includes("first"));
  assert.match(logs[0]!, /✓/);
  assert.match(logs[2]!, /✗/);
  assert.match(logs[3]!, /fourth — because reasons/);
});

test("each asserter keeps an independent tally", () => {
  const orig = console.log;
  console.log = () => {};
  try {
    const a = createAsserter();
    const b = createAsserter();
    a.assert("x", true);
    b.assert("y", false);
    assert.equal(a.pass, 1);
    assert.equal(a.fail, 0);
    assert.equal(b.pass, 0);
    assert.equal(b.fail, 1);
  } finally {
    console.log = orig;
  }
});
