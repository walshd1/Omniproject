import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sharedKv,
  sharedStateMode,
  sharedRingPush,
  sharedRingRead,
  __resetSharedStateForTest,
  __setRedisKvForTest,
} from "./shared-state";
import { FakeRedis } from "../__tests__/fake-redis";

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

// ── Atomic primitives (incr / cas) — run against BOTH backends ──────────────────────
// Each case runs once on the default in-process backend and once on the RedisKv backend driven
// by the FakeRedis double (native INCRBY + the atomic CAS Lua), so both paths are covered.
type Backend = { name: string; setup: () => FakeRedis | null };
const BACKENDS: Backend[] = [
  { name: "in-process", setup: () => null },
  { name: "redis (fake)", setup: () => { const r = new FakeRedis(); __setRedisKvForTest(r); return r; } },
];

for (const backend of BACKENDS) {
  test(`[${backend.name}] incr: absent starts at 0 and returns each new value`, async () => {
    backend.setup();
    assert.equal(await sharedKv.incr("c"), 1);
    assert.equal(await sharedKv.incr("c"), 2);
    assert.equal(await sharedKv.incr("c", 5), 7);
    assert.equal(await sharedKv.get("c"), "7");
  });

  test(`[${backend.name}] incr: concurrent increments never lose an update (serialised)`, async () => {
    const fake = backend.setup();
    const N = 200;
    await Promise.all(Array.from({ length: N }, () => sharedKv.incr("hits")));
    assert.equal(await sharedKv.get("hits"), String(N));
    if (fake) assert.equal(fake.calls["incrby"], N); // proves the native atomic ran, not a get+set
  });

  test(`[${backend.name}] cas: null-expected swaps only when absent`, async () => {
    backend.setup();
    assert.equal(await sharedKv.cas("k", null, "first"), true);  // absent → set
    assert.equal(await sharedKv.get("k"), "first");
    assert.equal(await sharedKv.cas("k", null, "again"), false); // now present → refused
    assert.equal(await sharedKv.get("k"), "first");
  });

  test(`[${backend.name}] cas: value-expected swaps only on an exact match`, async () => {
    backend.setup();
    await sharedKv.set("k", "A");
    assert.equal(await sharedKv.cas("k", "WRONG", "B"), false);
    assert.equal(await sharedKv.get("k"), "A");
    assert.equal(await sharedKv.cas("k", "A", "B"), true);
    assert.equal(await sharedKv.get("k"), "B");
  });

  test(`[${backend.name}] cas: concurrent CAS on one value — exactly one winner`, async () => {
    const fake = backend.setup();
    await sharedKv.set("head", "v0");
    const attempts = await Promise.all(
      Array.from({ length: 50 }, (_, i) => sharedKv.cas("head", "v0", `v-${i}`)),
    );
    assert.equal(attempts.filter(Boolean).length, 1, "only one CAS may win the transition from v0");
    if (fake) assert.equal(fake.calls["eval"], 50); // every CAS went through the atomic Lua
  });

  test(`[${backend.name}] cas loop: N racers increment a shared counter with no lost update`, async () => {
    backend.setup();
    // A lock-free counter via CAS (the audit-head advance pattern): read → compute → CAS → retry.
    async function bump(): Promise<void> {
      for (;;) {
        const cur = await sharedKv.get("n");
        const next = String(Number(cur ?? 0) + 1);
        if (await sharedKv.cas("n", cur, next)) return;
      }
    }
    await Promise.all(Array.from({ length: 100 }, () => bump()));
    assert.equal(await sharedKv.get("n"), "100");
  });

  test(`[${backend.name}] shared ring: push/read keeps insertion order, bounded at max`, async () => {
    backend.setup();
    for (let i = 0; i < 10; i++) await sharedRingPush("ring:", `e${i}`, 4);
    const got = await sharedRingRead("ring:", 4);
    assert.deepEqual(got, ["e6", "e7", "e8", "e9"]); // only the last 4 survive the window
  });
}
