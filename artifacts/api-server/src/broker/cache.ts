import type { ActorContext, Broker } from "./types";
import { adaptiveTtl, recordLatency, adaptiveStats } from "./adaptive-ttl";

/**
 * OPT-IN server-side read cache — a short-TTL, in-memory cache of broker reads.
 *
 * This is a deliberate PERFORMANCE MODE that TRADES the product's "never stale"
 * guarantee for latency: a read may be served from memory for up to the TTL instead
 * of hitting the backend live. It is the one feature that puts backend data on the
 * server (in RAM, briefly) — so it is OFF by default, behind an explicit flag
 * (`READ_CACHE_TTL_MS`), and announced loudly at boot. Use it for dispersed/high-
 * latency deployments where a few seconds of staleness is an acceptable trade.
 *
 * Safety properties:
 *  - PER-ACTOR keys: entries are keyed by the caller's identity, so one user's
 *    cached data is never served to another (reads are performed "as" the user).
 *  - WRITE-THROUGH: any write through the broker (or `invalidateReadCache()` from the
 *    command paths) clears the cache, so a change you make is visible immediately.
 *  - BOUNDED + EPHEMERAL: a capped Map, per-replica, gone on restart — never disk.
 */

/** The broker methods that are pure reads — safe to cache and to coalesce (single-flight). */
export const READ_METHODS = new Set([
  "listProjects", "listIssues", "getIssue", "projectMembers", "listTaskItems",
  "listActivity", "projectSummary", "projectHistory", "baseline", "listRaid",
  "notifications", "portfolioHealth", "resourceCapacity", "projectFinancials",
  "capabilities", "fxRates",
]);
const WRITE_METHODS = new Set([
  "createProject", "updateProject", "writeIssue", "createTaskItem", "addRaid",
]);

const MAX_ENTRIES = 2000;

/** The configured TTL in ms (0 ⇒ disabled). */
export function readCacheTtlMs(): number {
  const n = Number(process.env["READ_CACHE_TTL_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Is the opt-in read cache active? */
export function readCacheEnabled(): boolean {
  return readCacheTtlMs() > 0;
}

const stats = { hits: 0, misses: 0 };
/** Cache hit/miss counters + the (possibly latency-adaptive) TTL config, for diagnostics. */
export function readCacheStats() {
  return { ...stats, enabled: readCacheEnabled(), ttlMs: readCacheTtlMs(), adaptive: adaptiveStats(readCacheTtlMs()) };
}

// The active cache's clear hook, so the generic command / raw-write paths (which
// bypass the wrapped broker) can still invalidate it.
let activeClear: (() => void) | null = null;
/** Clear the active read cache, if any (called by write/command paths + resetBroker). */
export function invalidateReadCache(): void {
  activeClear?.();
}

interface Entry { at: number; value: unknown; ttl: number }

/** A per-actor key prefix so one user's read is never shared with another (reads run "as" the user). */
export const actorKey = (a: unknown): string => {
  const ctx = a as ActorContext | undefined;
  return ctx?.sub ?? ctx?.email ?? "anon";
};

/** Wrap a broker so its reads are cached for the configured TTL (writes clear it). The TTL is fixed
 *  (`READ_CACHE_TTL_MS`) unless adaptive mode is on, in which case it's tuned per method from measured
 *  latency (lib/broker/adaptive-ttl) and stamped on each entry at fetch time. */
export function wrapWithCache(base: Broker, opts: { now?: () => number } = {}): Broker {
  const baseTtl = readCacheTtlMs();
  const now = opts.now ?? (() => Date.now());
  const store = new Map<string, Entry>();
  const clear = () => store.clear();
  activeClear = clear;

  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);

      if (WRITE_METHODS.has(method)) {
        return function (this: unknown, ...args: unknown[]) {
          clear(); // write-through: drop stale reads immediately
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (!READ_METHODS.has(method)) return (orig as (...a: unknown[]) => unknown).bind(target);

      return function (this: unknown, ...args: unknown[]) {
        const key = `${actorKey(args[0])}:${method}:${JSON.stringify(args.slice(1))}`;
        const hit = store.get(key);
        // Each entry carries the TTL chosen when it was fetched, so an adaptive TTL change later
        // doesn't retroactively extend an old entry's freshness window.
        if (hit && now() - hit.at < hit.ttl) {
          stats.hits++;
          return Promise.resolve(hit.value);
        }
        stats.misses++;
        const startedAt = now();
        const result = (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        void Promise.resolve(result)
          .then((value) => {
            // Feed the measured upstream latency back into the per-method TTL model.
            recordLatency(method, now() - startedAt);
            const ttl = adaptiveTtl(method, baseTtl);
            if (ttl <= 0) return; // adaptive mode may decide this (fast) method isn't worth caching
            if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
            store.set(key, { at: now(), value, ttl });
          })
          .catch(() => { /* don't cache failures */ });
        return result;
      };
    },
  }) as Broker;
}

/** Test-only: reset the hit/miss counters. */
export function resetReadCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
}
