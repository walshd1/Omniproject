import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithSharedCache, resetSharedCacheStats, sharedCacheStats } from "./shared-cache";
import { __resetSharedStateForTest } from "../lib/shared-state";
import type { Broker, ActorContext } from "./types";

/**
 * Fleet-wide shared read cache — coalesces repeated reads across replicas via the shared-state seam
 * (in-process here). Verifies: a repeated read is served from cache (one upstream call), per-actor
 * isolation, and write-through invalidation via the shared generation counter.
 */
beforeEach(() => { __resetSharedStateForTest(); resetSharedCacheStats(); process.env["READ_CACHE_TTL_MS"] = "5000"; });
afterEach(() => { delete process.env["READ_CACHE_TTL_MS"]; });

const ctx = (sub: string): ActorContext => ({ sub } as ActorContext);

/** A broker whose listProjects counts calls and whose updateProject is a no-op write. */
function countingBroker(calls: { n: number }): Broker {
  return {
    async listProjects(_c: ActorContext) { calls.n++; return [{ id: `p${calls.n}` }] as never; },
    async updateProject(_c: ActorContext, _id: string, _input: unknown) { return { id: "p1" } as never; },
  } as unknown as Broker;
}

test("a repeated identical read is served from the shared cache (one upstream call)", async () => {
  const calls = { n: 0 };
  const b = wrapWithSharedCache(countingBroker(calls));
  const a = await b.listProjects(ctx("alice"));
  const c = await b.listProjects(ctx("alice"));
  assert.equal(calls.n, 1); // second read hit the cache
  assert.deepEqual(a, c);
  assert.equal(sharedCacheStats().hits, 1);
  assert.equal(sharedCacheStats().misses, 1);
});

test("per-actor isolation: a different actor does not share the cached value", async () => {
  const calls = { n: 0 };
  const b = wrapWithSharedCache(countingBroker(calls));
  await b.listProjects(ctx("alice"));
  await b.listProjects(ctx("bob")); // different actor key ⇒ its own upstream call
  assert.equal(calls.n, 2);
});

test("write-through: a broker write bumps the generation and invalidates cached reads fleet-wide", async () => {
  const calls = { n: 0 };
  const b = wrapWithSharedCache(countingBroker(calls));
  await b.listProjects(ctx("alice")); // caches under generation 0
  assert.equal(calls.n, 1);
  await b.updateProject(ctx("alice"), "p1", {}); // bumps generation
  await b.listProjects(ctx("alice")); // new generation ⇒ miss ⇒ fresh read
  assert.equal(calls.n, 2);
});
