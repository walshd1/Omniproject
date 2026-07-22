import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_RESULT_KINDS, BINARY_KEY_RESULT_KINDS, isBinaryKeyResultKind, formatKeyResultValue } from "./goal-catalogue";

/** The goal key-result primitive catalogue — the source of truth for the `keyResult` primitive family. */

test("KEY_RESULT_KINDS is the closed set the primitive family draws from", () => {
  assert.deepEqual([...KEY_RESULT_KINDS], ["number", "percent", "currency", "milestone"]);
  assert.deepEqual([...BINARY_KEY_RESULT_KINDS], ["milestone"]);
  assert.equal(isBinaryKeyResultKind("milestone"), true);
  assert.equal(isBinaryKeyResultKind("number"), false);
});

test("formatKeyResultValue renders each kind's value semantics", () => {
  assert.equal(formatKeyResultValue("percent", 75), "75%");
  assert.equal(formatKeyResultValue("currency", 1000, "$"), "$ 1,000");
  assert.equal(formatKeyResultValue("milestone", 1), "Done");
  assert.equal(formatKeyResultValue("milestone", 0), "Not done");
  assert.equal(formatKeyResultValue("number", 42, "users"), "42 users");
});
