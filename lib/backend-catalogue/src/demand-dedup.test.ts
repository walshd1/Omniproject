import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDuplicateDemand } from "./demand-dedup";

test("identical token sets ⇒ similarity 1.0", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "login bug" },
    { id: "b", text: "bug login" }, // same tokens, different order
  ]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0]!.similarity, 1);
  assert.deepEqual(r.pairs[0]!.shared, ["bug", "login"]);
});

test("partial overlap at/above the threshold is reported with shared tokens", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "alpha beta gamma" },
    { id: "b", text: "alpha beta delta" }, // ∩ = {alpha,beta}=2, ∪=4 ⇒ 0.5
  ]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0]!.similarity, 0.5);
  assert.deepEqual(r.pairs[0]!.shared, ["alpha", "beta"]);
});

test("overlap below the threshold is excluded", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "alpha beta gamma" },
    { id: "b", text: "alpha xray yankee zulu" }, // ∩ = {alpha}=1, ∪=6 ⇒ 0.1667
  ]);
  assert.deepEqual(r.pairs, []);
  assert.deepEqual(r.clusters, []);
});

test("a lower threshold widens the net", () => {
  const items = [
    { id: "a", text: "alpha beta gamma" },
    { id: "b", text: "alpha xray yankee zulu" },
  ];
  assert.equal(detectDuplicateDemand(items, { threshold: 0.15 }).pairs.length, 1);
});

test("tags fold into the token set", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "alpha", tags: ["beta"] },
    { id: "b", text: "alpha beta" },
  ]);
  assert.equal(r.pairs[0]!.similarity, 1);
});

test("transitive duplicates group into one cluster (union-find)", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "alpha beta charlie" },
    { id: "b", text: "alpha beta delta" }, // a≈b 0.5
    { id: "c", text: "alpha beta echo" }, // a≈c 0.5, b≈c 0.5
    { id: "z", text: "totally unrelated words here" },
  ]);
  assert.deepEqual(r.clusters, [["a", "b", "c"]]); // z is not linked
});

test("pairs are ranked by similarity descending, then id", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "alpha beta gamma delta" },
    { id: "b", text: "alpha beta gamma delta" }, // a≈b 1.0
    { id: "c", text: "alpha beta gamma zulu" }, // a≈c, b≈c = 3/5 = 0.6
  ]);
  assert.deepEqual(
    r.pairs.map((p) => [p.aId, p.bId, p.similarity]),
    [["a", "b", 1], ["a", "c", 0.6], ["b", "c", 0.6]],
  );
});

test("empty / whitespace-only text contributes no tokens and never yields NaN", () => {
  const r = detectDuplicateDemand([
    { id: "a", text: "" },
    { id: "b", text: "   " },
    { id: "c" }, // no text at all
  ]);
  assert.deepEqual(r.pairs, []);
  assert.deepEqual(r.clusters, []);
});

test("empty input ⇒ empty result", () => {
  const r = detectDuplicateDemand([]);
  assert.deepEqual(r.pairs, []);
  assert.deepEqual(r.clusters, []);
});

test("short noise tokens are dropped by the default min length", () => {
  // "a" and "to" (len 1/2): with the default minTokenLength 2, "a" drops, "to" stays.
  const r = detectDuplicateDemand([
    { id: "x", text: "a to database" },
    { id: "y", text: "a to database" },
  ]);
  // Both reduce to {to, database}; identical ⇒ 1.0 (the len-1 "a" was dropped from both).
  assert.equal(r.pairs[0]!.similarity, 1);
  assert.deepEqual(r.pairs[0]!.shared, ["database", "to"]);
});
