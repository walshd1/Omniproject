import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGuidAliases, resolveGuid, GuidAliasError } from "./guid-aliases";

test("validateGuidAliases normalises and rejects self-aliases", () => {
  assert.deepEqual(validateGuidAliases({ " a ": " b ", c: "d" }), { a: "b", c: "d" });
  assert.throws(() => validateGuidAliases({ a: "a" }), /cannot point at itself/);
  assert.throws(() => validateGuidAliases({ a: "" }), /non-empty GUID/);
  assert.throws(() => validateGuidAliases([]), GuidAliasError);
});

test("validateGuidAliases rejects a cycle", () => {
  assert.throws(() => validateGuidAliases({ a: "b", b: "a" }), /cycle/);
  assert.throws(() => validateGuidAliases({ a: "b", b: "c", c: "a" }), /cycle/);
});

test("resolveGuid follows the relink chain to the current identity", () => {
  const aliases = { old1: "old2", old2: "current" };
  assert.equal(resolveGuid("old1", aliases), "current"); // multi-hop
  assert.equal(resolveGuid("old2", aliases), "current");
  assert.equal(resolveGuid("current", aliases), "current"); // no alias ⇒ unchanged
  assert.equal(resolveGuid("unknown", aliases), "unknown");
});

test("resolveGuid terminates even on a cyclic table (defensive)", () => {
  // validation rejects cycles, but resolution must never loop on bad data.
  const cyclic = { a: "b", b: "a" };
  const out = resolveGuid("a", cyclic);
  assert.ok(out === "a" || out === "b"); // terminates with SOME value, no hang
});

test("resolveGuid treats a prototype key as having no alias (no type confusion)", () => {
  assert.equal(resolveGuid("__proto__", {} as never), "__proto__");
  assert.equal(resolveGuid("constructor", {} as never), "constructor");
});
