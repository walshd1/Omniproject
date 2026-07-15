import type { Broker } from "./types";
import { READ_METHODS, WRITE_METHODS, readKey, readCacheTtlMs } from "./cache";
import { sharedKv } from "../lib/shared-state";
import { safeParseJson } from "../lib/safe-json";
import { envFlag } from "../lib/env";

/**
 * FLEET-WIDE read coalescing — an OPT-IN, short-TTL read cache backed by the shared-state seam
 * (Redis when `REDIS_URL` is set, in-process otherwise). Where the always-on single-flight coalesces
 * concurrent identical reads WITHIN one replica, this shares the cached result ACROSS replicas: at N
 * replicas, "1000 users open the same dashboard" collapses toward one backend read per TTL for the
 * whole fleet, not one per replica.
 *
 * It is the fleet-wide analogue of the per-replica `wrapWithCache`, and inherits its exact contract:
 *  - OFF by default — needs `READ_CACHE_TTL_MS` (a TTL) AND `READ_CACHE_SHARED=true`. With neither set
 *    nothing here runs, so the zero-at-rest default posture is unchanged.
 *  - PER-ACTOR keys (`readKey`), so one user's cached read is never served to another.
 *  - WRITE-THROUGH via a shared GENERATION counter: any broker write bumps the generation, so every
 *    replica's next read computes a new-generation key and misses — the same "your write is visible
 *    immediately" guarantee the in-memory cache gives, now fleet-wide. Old-generation entries fall out
 *    on their TTL.
 *  - Values are the broker's own JSON-serialisable read results; they are parsed back with
 *    safeParseJson (the shared KV is an untrusted deserialization boundary — strips __proto__ etc.).
 *
 * Best-effort: a shared-store error never fails the read — it falls through to the live broker call.
 */

const GEN_KEY = "brk:rc:gen";
const KEY_PREFIX = "brk:rc:";

const stats = { hits: 0, misses: 0 };
/** Fleet cache hit/miss counters (diagnostics). */
export function sharedCacheStats(): { hits: number; misses: number } {
  return { ...stats };
}
/** Test-only: reset the counters. */
export function resetSharedCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
}

/** Active only when the base read cache is enabled AND the shared flag is set — off by default. */
export function sharedReadCacheEnabled(): boolean {
  return readCacheTtlMs() > 0 && envFlag("READ_CACHE_SHARED");
}

/** The current cache generation (a write-bumped counter); "0" when unset or the store is unreachable. */
async function generation(): Promise<string> {
  return (await sharedKv.get(GEN_KEY).catch(() => null)) ?? "0";
}

/**
 * Wrap a broker so its reads are served from the shared short-TTL cache and its writes bump the
 * generation. Mirrors `wrapWithCache` (memoized per-method wrappers; non-reads pass through).
 */
export function wrapWithSharedCache(base: Broker): Broker {
  const ttlMs = readCacheTtlMs();
  const wrappers = new Map<PropertyKey, unknown>();

  return new Proxy(base, {
    get(target, prop, receiver) {
      const memo = wrappers.get(prop);
      if (memo !== undefined) return memo;
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig; // non-function props pass through, never memoized
      const method = String(prop);

      let wrapper: unknown;
      if (WRITE_METHODS.has(method)) {
        wrapper = async function (this: unknown, ...args: unknown[]) {
          const out = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          // Write-through: bump the shared generation so every replica's cached reads are invalidated.
          await sharedKv.incr(GEN_KEY).catch(() => { /* best-effort — a live write still succeeded */ });
          return out;
        };
      } else if (!READ_METHODS.has(method)) {
        wrapper = (orig as (...a: unknown[]) => unknown).bind(target);
      } else {
        wrapper = async function (this: unknown, ...args: unknown[]) {
          const key = `${KEY_PREFIX}${await generation()}:${readKey(method, args)}`;
          const cached = await sharedKv.get(key).catch(() => null);
          if (cached !== null) {
            stats.hits++;
            return safeParseJson(cached);
          }
          stats.misses++;
          const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          // Populate best-effort; a store write failure must not fail the read.
          void sharedKv.set(key, JSON.stringify(result), { ttlMs }).catch(() => {});
          return result;
        };
      }
      wrappers.set(prop, wrapper);
      return wrapper;
    },
  }) as Broker;
}
