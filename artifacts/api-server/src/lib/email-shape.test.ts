import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmailShape } from "./email-shape";

/**
 * Linear email-shape check (replaces a polynomial-backtracking regex, CWE-1333). Accept set mirrors the old
 * /^[^\s@]+@[^\s@]+\.[^\s@]+$/ (minus trailing-dot domains), and it must stay fast on adversarial input.
 */

test("accepts basic valid shapes", () => {
  for (const ok of ["a@b.com", "a.b@c.d", "x@sub.domain.co", "a@b..c", "user+tag@host.example"]) {
    assert.equal(isEmailShape(ok), true, ok);
  }
});

test("rejects malformed shapes", () => {
  for (const bad of ["notanemail", "a@b", "@b.com", "a@.com", "a@b.", "a b@c.com", "a@b c.com", "a@@b.com", "", "a@", "a@b.c ", " a@b.c"]) {
    assert.equal(isEmailShape(bad), false, bad);
  }
});

test("stays fast (linear) on a long adversarial input — no catastrophic backtracking", () => {
  // A string that maximised backtracking in the old regex: many non-dot chars after '@', no valid domain dot.
  const evil = "a@" + "a".repeat(100_000);
  const start = process.hrtime.bigint();
  assert.equal(isEmailShape(evil), false);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 50, `took ${ms}ms — expected linear/near-instant`);
});
