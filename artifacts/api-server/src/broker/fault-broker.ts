import type { Broker } from "./types";
import { isDevMode } from "../lib/dev-mode";

/**
 * Fault-injecting broker decorator — DEV MODE ONLY (plus an explicit in-process test hook).
 *
 * The sibling of `messy-broker.ts`. That one answers "how do our derivations cope with dirty data";
 * this one answers "how do they cope with NO data" — the failure the stateless architecture is most
 * exposed to, because there is no cache to fall back on when a backend stops answering.
 *
 * It exists because degraded-read behaviour (docs/DEGRADED-READS.md) was otherwise untestable: the
 * demo broker always succeeds, so nothing could exercise "3 of 4 sources answered" end to end. A rule
 * that cannot be tested is a rule that quietly stops holding.
 *
 * HARD-GATED, two independent gates and neither reachable in production:
 *   - `DEV_BROKER_FAULTS` is read only when `isDevMode()` (itself false under NODE_ENV=production);
 *   - `__setBrokerFaultsForTest` is an in-process hook with no env or network surface at all, the
 *     same pattern as `__setEgressTransportForTest` in lib/egress.ts.
 *
 * PLACEMENT. Innermost, closest to the real broker, so a fault propagates up through the entire
 * decorator chain exactly as a genuine backend failure would — the sanitizer, single-flight, cache
 * and provenance layers all see it. A cache HIT still bypasses it, which is correct: a served cache
 * hit reaches no backend, so no backend can fail it.
 */

/** Which calls should fail. A method matches when it is listed (or `methods` is empty, meaning all);
 *  an argument matches when any string argument to the call is listed in `args` (or `args` is empty). */
export interface FaultSpec {
  /** Broker method names to fail, e.g. `["projectFinancials"]`. Empty ⇒ every method. */
  methods?: string[];
  /** String arguments that select a call, e.g. a projectId `["p-2"]`. Empty ⇒ every call of the method. */
  args?: string[];
  /** How it fails. `error` throws immediately; `timeout` rejects with a timeout-shaped error, which is
   *  the more common real failure and takes a different path through error mapping. */
  mode?: "error" | "timeout";
  /** Message on the thrown error. Defaults to something obviously synthetic. */
  message?: string;
}

let testSpec: FaultSpec | null = null;

/**
 * Arm (or disarm with `null`) fault injection for the current process — the TEST hook. No env var, no
 * production path; a test sets it, asserts, and clears it in `afterEach`.
 *
 * CALL `resetBroker()` AFTER THIS. The decorator chain is built once and memoised, and whether the
 * fault layer is in it is decided at build time, so arming after `getBroker()` has run has no effect
 * until the singleton is rebuilt. Arming is deliberately usable outside dev mode — the route harness
 * runs with `NODE_ENV=production` — which is safe because this hook is in-process only and cannot be
 * reached by configuration or by a request.
 *
 *   __setBrokerFaultsForTest({ methods: ["projectFinancials"], args: ["p-2"] });
 *   resetBroker();
 *   // …exercise…
 *   __setBrokerFaultsForTest(null); resetBroker();
 */
export function __setBrokerFaultsForTest(spec: FaultSpec | null): void {
  testSpec = spec;
}

/** Parse `DEV_BROKER_FAULTS` — `method[:arg][,method[:arg]]…`, optionally suffixed `@timeout`.
 *  e.g. `projectFinancials:p-2` or `listProjects@timeout` or `resourceCapacity:p-1,projectFinancials:p-1`.
 *  Returns null when unset or unparseable, so a typo degrades to "no faults", never to "fail everything". */
export function parseFaultEnv(raw: string | undefined): FaultSpec[] | null {
  const text = raw?.trim();
  if (!text) return null;
  const specs: FaultSpec[] = [];
  for (const part of text.split(",")) {
    const [body, modeRaw] = part.split("@");
    const [method, arg] = (body ?? "").trim().split(":");
    if (!method) continue;
    const spec: FaultSpec = { methods: [method.trim()], mode: modeRaw?.trim() === "timeout" ? "timeout" : "error" };
    if (arg?.trim()) spec.args = [arg.trim()];
    specs.push(spec);
  }
  return specs.length ? specs : null;
}

/** The specs in force: the test hook if set, else the dev-only env. Empty when disarmed. */
function activeSpecs(): FaultSpec[] {
  if (testSpec) return [testSpec];
  if (!isDevMode()) return [];
  return parseFaultEnv(process.env["DEV_BROKER_FAULTS"]) ?? [];
}

/** Is fault injection armed at all? False in production, and false in dev unless configured. */
export function brokerFaultsArmed(): boolean {
  return activeSpecs().length > 0;
}

/** Does `spec` select this call? */
export function faultMatches(spec: FaultSpec, method: string, args: readonly unknown[]): boolean {
  const methods = spec.methods ?? [];
  if (methods.length && !methods.includes(method)) return false;
  const wanted = spec.args ?? [];
  if (!wanted.length) return true;
  return args.some((a) => typeof a === "string" && wanted.includes(a));
}

/** The error a matched call rejects with. `timeout` is shaped so `isTimeoutError` recognises it, since
 *  timeout and hard-error take different paths through the gateway's error mapping. */
export function faultError(spec: FaultSpec, method: string): Error {
  const msg = spec.message ?? `injected ${spec.mode ?? "error"} fault: ${method}`;
  if ((spec.mode ?? "error") === "timeout") {
    const err = new Error(msg);
    err.name = "TimeoutError";
    return err;
  }
  return new Error(msg);
}

/** Wrap a broker so selected calls fail. A no-op unless armed, so the chain is unchanged in production. */
export function wrapWithFaults(base: Broker): Broker {
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(base, {
    get(target, prop, receiver) {
      const memo = wrappers.get(prop);
      if (memo !== undefined) return memo;
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);
      const wrapper = async function (this: unknown, ...args: unknown[]) {
        // Re-read per CALL so a test can arm/disarm between assertions without rebuilding the broker.
        for (const spec of activeSpecs()) {
          if (faultMatches(spec, method, args)) throw faultError(spec, method);
        }
        return (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      };
      wrappers.set(prop, wrapper);
      return wrapper;
    },
  }) as Broker;
}
