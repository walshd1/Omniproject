import { test } from "node:test";
import assert from "node:assert/strict";
import { createConcurrencyLimiter, poolMap } from "./concurrency-pool";

test("poolMap never exceeds the concurrency limit", async () => {
  const limit = 4;
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 40 }, (_, i) => i);

  await poolMap(items, limit, async (i) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    return i * 2;
  });

  assert.ok(maxActive <= limit, `max concurrent was ${maxActive}, expected <= ${limit}`);
});

test("poolMap resolves every item in input order regardless of completion order", async () => {
  const items = [30, 10, 20, 5];
  const results = await poolMap(items, 2, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms;
  });
  assert.deepEqual(results, items);
});

test("poolMap propagates a rejection", async () => {
  await assert.rejects(
    () => poolMap([1, 2, 3], 2, async (i) => { if (i === 2) throw new Error("boom"); return i; }),
    /boom/,
  );
});

test("poolMap on an empty array resolves to an empty array without calling fn", async () => {
  let calls = 0;
  const results = await poolMap([], 4, async () => { calls++; return 1; });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("createConcurrencyLimiter bounds arbitrary ad-hoc calls (not just a fixed array)", async () => {
  const limit = 3;
  let active = 0;
  let maxActive = 0;
  const run = createConcurrencyLimiter(limit);

  const calls = Array.from({ length: 15 }, () =>
    run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    }),
  );
  await Promise.all(calls);
  assert.ok(maxActive <= limit, `max concurrent was ${maxActive}, expected <= ${limit}`);
});
