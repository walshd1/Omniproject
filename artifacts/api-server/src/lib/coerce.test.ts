import { test } from "node:test";
import assert from "node:assert/strict";
import { isStr, isNum, stringArray } from "./coerce";

test("isStr narrows to strings only", () => {
  assert.equal(isStr("a"), true);
  assert.equal(isStr(""), true);
  assert.equal(isStr(1), false);
  assert.equal(isStr(null), false);
  assert.equal(isStr(undefined), false);
  assert.equal(isStr({}), false);
});

test("isNum accepts finite numbers, rejects NaN/Infinity/non-numbers", () => {
  assert.equal(isNum(0), true);
  assert.equal(isNum(-3.5), true);
  assert.equal(isNum(NaN), false);
  assert.equal(isNum(Infinity), false);
  assert.equal(isNum("1"), false);
  assert.equal(isNum(null), false);
});

test("stringArray keeps only string members, and is [] for a non-array", () => {
  assert.deepEqual(stringArray(["a", 1, "b", null, "c"]), ["a", "b", "c"]);
  assert.deepEqual(stringArray([]), []);
  assert.deepEqual(stringArray("nope"), []);
  assert.deepEqual(stringArray(null), []);
});
