import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sharedKv, sharedStateMode, __resetSharedStateForTest } from "./shared-state";

// No REDIS_URL in the test env ⇒ the in-process backend, with identical semantics to Redis.
afterEach(async () => { await sharedKv.clear(); __resetSharedStateForTest(); });

test("defaults to in-process mode when REDIS_URL is unset", () => {
  assert.equal(sharedStateMode(), "in-process");
});

test("get/set/del round-trip", async () => {
  assert.equal(await sharedKv.get("a"), null);
  await sharedKv.set("a", "1");
  assert.equal(await sharedKv.get("a"), "1");
  await sharedKv.del("a");
  assert.equal(await sharedKv.get("a"), null);
});

test("list returns only the entries under a prefix", async () => {
  await sharedKv.set("q:1", "one");
  await sharedKv.set("q:2", "two");
  await sharedKv.set("other:3", "three");
  const q = (await sharedKv.list("q:")).sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(q, [{ key: "q:1", value: "one" }, { key: "q:2", value: "two" }]);
});

test("a TTL expires the entry", async () => {
  await sharedKv.set("temp", "x", { ttlMs: 5 });
  assert.equal(await sharedKv.get("temp"), "x");
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(await sharedKv.get("temp"), null);
  assert.equal((await sharedKv.list("temp")).length, 0); // expired entries don't list
});

test("clear(prefix) drops only that namespace; clear() drops all", async () => {
  await sharedKv.set("ns:a", "1");
  await sharedKv.set("keep", "2");
  await sharedKv.clear("ns:");
  assert.equal(await sharedKv.get("ns:a"), null);
  assert.equal(await sharedKv.get("keep"), "2");
  await sharedKv.clear();
  assert.equal(await sharedKv.get("keep"), null);
});
