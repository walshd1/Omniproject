import { describe, it, expect } from "vitest";
import { createConcurrencyLimiter, poolMap } from "./concurrency-pool";

describe("poolMap", () => {
  it("never exceeds the concurrency limit", async () => {
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

    expect(maxActive).toBeLessThanOrEqual(limit);
  });

  it("resolves every item in input order regardless of completion order", async () => {
    const items = [30, 10, 20, 5];
    const results = await poolMap(items, 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual(items);
  });

  it("propagates a rejection", async () => {
    await expect(
      poolMap([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      }),
    ).rejects.toThrow("boom");
  });

  it("resolves to an empty array without calling fn on an empty input", async () => {
    let calls = 0;
    const results = await poolMap([], 4, async () => {
      calls++;
      return 1;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("createConcurrencyLimiter", () => {
  it("bounds arbitrary ad-hoc calls (not just a fixed array)", async () => {
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
    expect(maxActive).toBeLessThanOrEqual(limit);
  });
});
