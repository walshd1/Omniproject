import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadCache } from "./read-cache";

/**
 * Short-TTL read cache — verifies the TTL pass-through, the disabled (TTL=0) no-op, and the size
 * bound: it must not grow without limit (LRU eviction + expiry sweep) so memory tracks the working
 * set, not every distinct key ever seen.
 */

test("disabled cache (ttl 0) is a transparent no-op", () => {
  const c = new ReadCache(0);
  assert.equal(c.enabled(), false);
  c.set("k", 1);
  assert.equal(c.get("k"), undefined);
});

test("stores within the TTL and expires after it", () => {
  const c = new ReadCache(1_000);
  c.set("k", "v", 0);
  assert.equal(c.get("k", 500), "v");
  assert.equal(c.get("k", 1_000), undefined); // exp <= now
});

test("bounds the store to maxEntries, evicting least-recently-used first", () => {
  const c = new ReadCache(10_000, 3);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("c", 3, 0);
  c.get("a", 0); // touch → a is now most-recently-used, b is the LRU
  c.set("d", 4, 0); // over cap → evict the LRU (b)
  assert.equal(c.get("b", 0), undefined);
  assert.equal(c.get("a", 0), 1);
  assert.equal(c.get("c", 0), 3);
  assert.equal(c.get("d", 0), 4);
});

test("eviction drops expired entries before live ones", () => {
  const c = new ReadCache(1_000, 3);
  c.set("old", 1, 0); // expires at 1000
  c.set("x", 2, 900);
  c.set("y", 3, 900);
  // At now=1500 "old" is expired; adding a 4th entry sweeps it and stays within cap without dropping live keys.
  c.set("z", 4, 1_500);
  assert.equal(c.get("old", 1_500), undefined);
  assert.equal(c.get("x", 1_500), 2);
  assert.equal(c.get("y", 1_500), 3);
  assert.equal(c.get("z", 1_500), 4);
});
