import type { Broker } from "./types";
import { READ_METHODS, actorKey } from "./cache";

/**
 * Single-flight (request coalescing) for broker READS — ALWAYS ON.
 *
 * When several callers ask for the SAME read (same actor, method and args) while one is already
 * in flight, they share that one upstream call instead of each issuing their own. At scale this is
 * the difference between "N users open the same dashboard ⇒ N identical backend calls" and "⇒ 1",
 * which directly protects the customer's backend (and its rate limits) from a thundering herd.
 *
 * Unlike the opt-in TTL read cache (lib/broker/cache), this introduces NO staleness and so is safe
 * to keep on unconditionally: coalesced callers were all requesting "now", and they all receive the
 * very result the single live call returns (or the same rejection). The in-flight entry is dropped
 * the moment that call settles, so the next request fetches fresh.
 *
 * Per-actor keys (reads run "as" the user) mean one user's in-flight read is never shared with
 * another. Only READ methods coalesce — writes always execute independently. Sits BELOW the cache,
 * so a cache hit never reaches it; sits below provenance, so every logical call is still recorded.
 */

const stats = { calls: 0, coalesced: 0 };

/** Single-flight diagnostics: upstream `calls` issued vs `coalesced` (calls saved). */
export function singleFlightStats(): { calls: number; coalesced: number } {
  return { ...stats };
}

/** Test-only: reset the counters. */
export function resetSingleFlightStats(): void {
  stats.calls = 0;
  stats.coalesced = 0;
}

/** Wrap a broker so concurrent identical reads share a single in-flight upstream call. */
export function wrapWithSingleFlight(base: Broker): Broker {
  const inflight = new Map<string, Promise<unknown>>();

  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);
      if (!READ_METHODS.has(method)) return (orig as (...a: unknown[]) => unknown).bind(target);

      return function (this: unknown, ...args: unknown[]) {
        const key = `${actorKey(args[0])}:${method}:${JSON.stringify(args.slice(1))}`;
        const existing = inflight.get(key);
        if (existing) { stats.coalesced++; return existing; }

        stats.calls++;
        const flight = Promise.resolve((orig as (...a: unknown[]) => Promise<unknown>).apply(target, args))
          .finally(() => { inflight.delete(key); });
        inflight.set(key, flight);
        return flight;
      };
    },
  }) as Broker;
}
