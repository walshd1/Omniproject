import { BrokerError, type Broker } from "./types";
import { isDevMode } from "../lib/dev-mode";
import { pskEnabled } from "../lib/broker-psk";

/**
 * Keyed-access guard for the live broker. POSTURE: no request reaches a real broker or
 * vendor without a valid key. Outside dev mode, a live broker call requires the
 * gateway↔broker shared key (BROKER_PSK) to be configured — otherwise it's HARD-REJECTED
 * before anything leaves the gateway. Dev mode is the one exemption (spoofed brokers /
 * vendors / cassettes have no real key and never reach a real backend).
 *
 * Applied only to the live broker (see getBroker): demo/dev brokers serve sample data
 * and reach no vendor, so they need no key.
 */
export function assertKeyedAccess(): void {
  if (isDevMode()) return; // dev exemption
  if (!pskEnabled()) {
    throw new BrokerError("unauthorized", "broker/vendor access requires a configured key (BROKER_PSK) outside dev mode");
  }
}

/** Wrap a (live) broker so every call is hard-rejected unless a valid key is present. */
export function wrapWithKeyGuard<T extends Broker>(broker: T): T {
  // Memoize the per-method wrapper (this guard sits in front of every live broker call). The key
  // check still runs per CALL, inside the wrapper — caching the accessor never skips a guard.
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(broker, {
    get(target, prop, receiver) {
      const memo = wrappers.get(prop);
      if (memo !== undefined) return memo;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value; // non-function props pass through, never memoized
      const wrapper = (...args: unknown[]) => {
        assertKeyedAccess();
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
      wrappers.set(prop, wrapper);
      return wrapper;
    },
  });
}
