import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithCache, readCacheEnabled, invalidateReadCache, resetReadCacheStats } from "./cache";
import { resetAdaptive } from "./adaptive-ttl";
import type { ActorContext, Broker } from "./types";

/**
 * The opt-in read cache: short-TTL, per-actor, write-through, off by default.
 */

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { const r = fn(); if (r instanceof Promise) return r.finally(restore); restore(); } catch (e) { restore(); throw e; }
}

/** A broker stub that counts how many times each read actually executed. */
function countingBroker() {
  const calls = { listProjects: 0, createProject: 0 };
  const b = {
    kind: "demo", live: false,
    async listProjects(_ctx: ActorContext) { calls.listProjects++; return [{ id: `p${calls.listProjects}` }]; },
    async createProject(_ctx: ActorContext, _input: unknown) { calls.createProject++; return { id: "new" }; },
  } as unknown as Broker;
  return { b, calls };
}
const ctx = (sub: string): ActorContext => ({ sub } as ActorContext);

test("disabled by default (no READ_CACHE_TTL_MS)", () => {
  withEnv({ READ_CACHE_TTL_MS: undefined }, () => assert.equal(readCacheEnabled(), false));
  withEnv({ READ_CACHE_TTL_MS: "5000" }, () => assert.equal(readCacheEnabled(), true));
});

test("a repeated read within the TTL is served from cache (underlying called once)", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "60000" }, async () => {
    resetReadCacheStats();
    const { b, calls } = countingBroker();
    let t = 1000;
    const cached = wrapWithCache(b, { now: () => t });
    const a = await cached.listProjects(ctx("u1"));
    const c = await cached.listProjects(ctx("u1"));
    assert.deepEqual(a, c);
    assert.equal(calls.listProjects, 1, "second read should hit the cache");
  });
});

test("the cache expires after the TTL", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "1000" }, async () => {
    const { b, calls } = countingBroker();
    let t = 0;
    const cached = wrapWithCache(b, { now: () => t });
    await cached.listProjects(ctx("u1"));
    t = 1500; // past the 1000ms TTL
    await cached.listProjects(ctx("u1"));
    assert.equal(calls.listProjects, 2, "an expired entry must refetch");
  });
});

test("per-actor isolation — one user's cache is never served to another", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "60000" }, async () => {
    const { b, calls } = countingBroker();
    let t = 0;
    const cached = wrapWithCache(b, { now: () => t });
    const u1 = await cached.listProjects(ctx("u1"));
    const u2 = await cached.listProjects(ctx("u2"));
    assert.notDeepEqual(u1, u2, "different actors must not share a cache entry");
    assert.equal(calls.listProjects, 2);
  });
});

test("a write is write-through: it clears the cache so the change is visible", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "60000" }, async () => {
    const { b, calls } = countingBroker();
    let t = 0;
    const cached = wrapWithCache(b, { now: () => t });
    await cached.listProjects(ctx("u1"));       // cached
    await cached.createProject(ctx("u1"), {});  // clears
    await cached.listProjects(ctx("u1"));        // must refetch
    assert.equal(calls.listProjects, 2);
  });
});

/** A broker whose read advances a shared clock by `latencyMs`, so the cache measures that latency. */
function slowBroker(clock: { t: number }, latencyMs: number) {
  const calls = { listProjects: 0 };
  const b = {
    kind: "demo", live: false,
    async listProjects(_ctx: ActorContext) { calls.listProjects++; clock.t += latencyMs; return [{ id: `p${calls.listProjects}` }]; },
  } as unknown as Broker;
  return { b, calls };
}

test("adaptive: a slow method is cached with a latency-scaled TTL", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "1000", READ_CACHE_ADAPTIVE: "true", READ_CACHE_ADAPTIVE_FACTOR: "6", READ_CACHE_MAX_TTL_MS: "60000", READ_CACHE_ADAPTIVE_THRESHOLD_MS: "150" }, async () => {
    resetAdaptive();
    const clock = { t: 0 };
    const { b, calls } = slowBroker(clock, 800); // 800ms upstream ⇒ TTL ≈ 4800ms
    const cached = wrapWithCache(b, { now: () => clock.t });
    await cached.listProjects(ctx("u1"));        // miss: records ~800ms latency, caches with ~4800ms TTL
    clock.t += 3000;                              // 3s later — still inside the scaled TTL
    await cached.listProjects(ctx("u1"));
    assert.equal(calls.listProjects, 1, "still fresh under the latency-scaled TTL");
  });
});

test("adaptive: a fast method below the threshold is not cached", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "60000", READ_CACHE_ADAPTIVE: "true", READ_CACHE_ADAPTIVE_THRESHOLD_MS: "150" }, async () => {
    resetAdaptive();
    const clock = { t: 0 };
    const { b, calls } = slowBroker(clock, 20); // 20ms ⇒ below the 150ms threshold ⇒ not cached
    const cached = wrapWithCache(b, { now: () => clock.t });
    await cached.listProjects(ctx("u1"));
    await cached.listProjects(ctx("u1"));
    assert.equal(calls.listProjects, 2, "a fast method is refetched, not cached");
  });
});

test("invalidateReadCache() clears the active cache (for command/raw paths)", async () => {
  await withEnv({ READ_CACHE_TTL_MS: "60000" }, async () => {
    const { b, calls } = countingBroker();
    let t = 0;
    const cached = wrapWithCache(b, { now: () => t });
    await cached.listProjects(ctx("u1"));
    invalidateReadCache();
    await cached.listProjects(ctx("u1"));
    assert.equal(calls.listProjects, 2);
  });
});
