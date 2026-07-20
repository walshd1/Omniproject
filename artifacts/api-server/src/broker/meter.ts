import type { Broker } from "./types";
import { READ_METHODS, WRITE_METHODS } from "./cache";
import { recordUsage } from "../lib/usage-metering";

/**
 * Usage-metering wrapper for the LIVE backend broker — counts each real read/write call OmniProject
 * makes to the external backend, per vendor, into the fleet-wide usage meter (lib/usage-metering).
 *
 * Placement matters: this wraps the broker INNER to the cache + single-flight, so a cache hit or a
 * coalesced read (which never reaches the backend) is NOT counted — the meter reflects ACTUAL external
 * API calls, which is what an admin needs to manage a vendor's rate/spend limit. Recording is
 * fire-and-forget: a metering failure never affects the read/write. Applied only to a real external
 * backend (demo/dev/built-in brokers reach no vendor, so there's nothing to meter).
 */
export function wrapWithMeter(base: Broker, vendor: () => string): Broker {
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(base, {
    get(target, prop, receiver) {
      const memo = wrappers.get(prop);
      if (memo !== undefined) return memo;
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig; // non-function props pass through, never memoized
      const method = String(prop);
      // Only the methods that actually hit the backend are a metered "call"; everything else (kind,
      // capability probes, internal helpers) passes straight through unwrapped.
      if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) {
        return (orig as (...a: unknown[]) => unknown).bind(target);
      }
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const out = (orig as (...a: unknown[]) => unknown).apply(target, args);
        // Count one call+return to the backend vendor. Fire-and-forget — never awaited, never throws.
        void recordUsage(vendor(), { calls: 1 }).catch(() => {});
        return out;
      };
      wrappers.set(prop, wrapper);
      return wrapper;
    },
  }) as Broker;
}
