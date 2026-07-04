import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTrustProxy } from "./trust-proxy";

test("defaults to OFF (false) — unset, 0, false, off", () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(""), false);
  assert.equal(resolveTrustProxy("0"), false);
  assert.equal(resolveTrustProxy("false"), false);
  assert.equal(resolveTrustProxy("off"), false);
});

test("a bare truthy value trusts exactly ONE hop, not Express's unbounded true", () => {
  assert.equal(resolveTrustProxy("1"), 1);
  assert.equal(resolveTrustProxy("true"), 1);
  assert.equal(resolveTrustProxy("on"), 1);
  assert.equal(resolveTrustProxy("yes"), 1);
});

test("an explicit integer is honoured as a hop count", () => {
  assert.equal(resolveTrustProxy("2"), 2);
  assert.equal(resolveTrustProxy("5"), 5);
});

test("unrecognised values fail closed (don't silently trust)", () => {
  assert.equal(resolveTrustProxy("maybe"), false);
  assert.equal(resolveTrustProxy("-1"), false);
  assert.equal(resolveTrustProxy("1.5"), false);
});
