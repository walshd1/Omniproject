import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafePattern, isSafePattern, patternMatches, safeSearch, UnsafeRegexError, MAX_PATTERN_LENGTH } from "./safe-regex";

test("accepts ordinary patterns AND patterns that would ReDoS a backtracking engine", () => {
  // RE2 is linear-time, so the classic catastrophic shapes are valid here — we run them safely.
  for (const p of ["^[A-Z]+$", "\\d{4}-\\d{2}-\\d{2}", "foo|bar", "[a-z]+", "(a+)+", "(.*)*"]) {
    assert.equal(isSafePattern(p), true, p);
  }
});

test("rejects over-long and invalid patterns", () => {
  assert.equal(isSafePattern("["), false); // uncompilable
  assert.equal(isSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1)), false);
});

test("assertSafePattern throws UnsafeRegexError on an invalid pattern", () => {
  assert.throws(() => assertSafePattern("["), (e: unknown) => e instanceof UnsafeRegexError && /valid regular expression/.test((e as Error).message));
  assert.throws(() => assertSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1)), (e: unknown) => e instanceof UnsafeRegexError && /too long/.test((e as Error).message));
});

test("patternMatches uses search semantics and stays linear on a ReDoS-shaped input", () => {
  assert.equal(patternMatches("[A-Z]+", "abcABC"), true); // finds a match anywhere
  assert.equal(patternMatches("^[A-Z]+$", "abc"), false);
  const t0 = Date.now();
  assert.equal(patternMatches("(a+)+$", "a".repeat(80) + "X"), false); // native RegExp would hang
  assert.ok(Date.now() - t0 < 200, "RE2 matched in linear time");
});

test("safeSearch is case-insensitive and never throws on a bad pattern", () => {
  assert.equal(safeSearch("apollo", "Project Apollo"), true);
  assert.equal(safeSearch("[", "anything"), false); // invalid ⇒ no match, no throw
});
