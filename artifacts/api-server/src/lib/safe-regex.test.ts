import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafePattern, isSafePattern, compileSafe, safeSearch, UnsafeRegexError, MAX_PATTERN_LENGTH } from "./safe-regex";

test("accepts ordinary patterns, including a single quantified char-class", () => {
  for (const p of ["^[A-Z]+$", "\\d{4}-\\d{2}-\\d{2}", "foo|bar", "[a-z]+", "(ab)+"]) {
    assert.equal(isSafePattern(p), true, p);
  }
});

test("rejects the nested-quantifier ReDoS shape, over-long, and invalid patterns", () => {
  assert.equal(isSafePattern("(a+)+"), false);
  assert.equal(isSafePattern("(.*)*"), false);
  assert.equal(isSafePattern("["), false); // uncompilable
  assert.equal(isSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1)), false);
});

test("assertSafePattern throws UnsafeRegexError with a reason", () => {
  assert.throws(() => assertSafePattern("(a+)+"), (e: unknown) => e instanceof UnsafeRegexError && /nested quantifiers/.test((e as Error).message));
  assert.throws(() => assertSafePattern("["), (e: unknown) => e instanceof UnsafeRegexError && /valid regular expression/.test((e as Error).message));
});

test("compileSafe returns a working RegExp; flags are honoured", () => {
  assert.equal(compileSafe("^[A-Z]+$").test("ABC"), true);
  assert.equal(compileSafe("abc", "i").test("ABC"), true);
});

test("safeSearch is case-insensitive and never throws on a bad pattern", () => {
  assert.equal(safeSearch("apollo", "Project Apollo"), true);
  assert.equal(safeSearch("(a+)+", "anything"), false); // unsafe ⇒ no match, no throw
});
