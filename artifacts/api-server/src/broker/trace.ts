import { logger } from "../lib/logger";
import { isProductionEnv } from "../lib/node-env";
import { BrokerError, type Broker } from "./types";
import { captureEnabled, recordExchange } from "./capture";

/**
 * Plane trace decorator — makes any dispatch plane observable at the METHOD
 * boundary. `traced(plane, obj)` wraps an object in a Proxy that logs every call
 * (`→ plane.method` / `← plane.method` with timing, `✗` on failure) and, when
 * capture is armed, records the exchange to a replayable tape (capture.ts).
 *
 * It started on the broker seam (`wrapWithTrace`) but is plane-agnostic: the same
 * wrapper instruments notifications, reports and exports — each is registry
 * dispatch through a chokepoint, which is exactly what a Proxy traces. Being a
 * Proxy it needs no per-method wiring and auto-covers methods added later.
 *
 * STRONGLY GATED — a developer aid, shipped but inert in production:
 *  - `debugAllowed()` is false whenever NODE_ENV=production, so nothing traces OR
 *    captures in a released deployment regardless of flags (a CI guard asserts it).
 *  - Off by default; opt in with BROKER_TRACE=1 (trace) / BROKER_CAPTURE=<file>
 *    (capture) on a non-production build.
 *  - Redaction by default: credentials are NEVER emitted; trace VALUES are
 *    summarised to shape unless BROKER_TRACE_PAYLOADS=1 (a second non-prod flag).
 *    Captured tapes always carry full but secret-scrubbed payloads (replay needs
 *    the values; secrets are still masked).
 */

const log = logger.child({ mod: "plane-trace" });

/** Debug surfaces are inert in production, full stop. Fail-safe via `isProductionEnv`
 *  (a mis-cased / unknown NODE_ENV counts as production), shared with the dev-mode gate. */
export function debugAllowed(): boolean {
  return !isProductionEnv(process.env);
}

/** Is method-boundary tracing active? (Non-prod + opt-in.) */
export function traceEnabled(): boolean {
  return debugAllowed() && process.env["BROKER_TRACE"] === "1";
}

/** May we emit full (secret-scrubbed) payloads in the LOG, not just shapes? */
export function payloadsEnabled(): boolean {
  return debugAllowed() && process.env["BROKER_TRACE_PAYLOADS"] === "1";
}

/** Should a plane be instrumented at all (trace and/or capture armed)? */
export function instrumented(): boolean {
  return traceEnabled() || captureEnabled();
}

/** Keys whose values are never emitted, at any depth, in any mode. */
export const SECRET_KEYS = new Set(["token", "authheader", "authorization", "cookie", "psk", "password", "secret", "apikey", "api_key"]);

/** A structural descriptor — types/keys/lengths, NO values. The default trace view. */
export function shape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  const t = typeof value;
  if (t !== "object") return t;
  return `object{${Object.keys(value as object).sort().join(",")}}`;
}

/** Full values with secret keys masked and arrays bounded. */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return shape(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactDeep(v, depth + 1);
  }
  return out;
}

/** Render a value for the trace LINE per the current mode. */
function view(value: unknown): unknown {
  return payloadsEnabled() ? redactDeep(value) : shape(value);
}

/** A compact, leak-free error projection (BrokerError code preferred). */
export function errView(err: unknown): Record<string, unknown> {
  if (err instanceof BrokerError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: shape(err) };
}

/**
 * Wrap a single function so its calls are traced + (optionally) captured. Pure
 * decoration: the return value and any throw/rejection pass through untouched.
 */
export function traceFn<F extends (...args: never[]) => unknown>(plane: string, method: string, fn: F, thisArg?: unknown): F {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const self = thisArg ?? this;
    if (!instrumented()) return (fn as unknown as (...a: unknown[]) => unknown).apply(self, args);
    const started = Date.now();
    if (traceEnabled()) log.debug({ plane, method, args: args.map(view) }, `→ ${plane}.${method}`);
    const onOk = (result: unknown) => {
      const ms = Date.now() - started;
      if (traceEnabled()) log.debug({ plane, method, ms, result: view(result) }, `← ${plane}.${method}`);
      if (captureEnabled()) recordExchange({ plane, method, args, result, ms, ok: true });
    };
    const onErr = (err: unknown) => {
      const ms = Date.now() - started;
      if (traceEnabled()) log.warn({ plane, method, ms, err: errView(err) }, `✗ ${plane}.${method}`);
      if (captureEnabled()) recordExchange({ plane, method, args, ms, ok: false, error: errView(err) });
    };
    let out: unknown;
    try {
      out = (fn as unknown as (...a: unknown[]) => unknown).apply(self, args);
    } catch (err) {
      onErr(err);
      throw err;
    }
    if (out && typeof (out as Promise<unknown>).then === "function") {
      return (out as Promise<unknown>).then(
        (val) => { onOk(val); return val; },
        (err) => { onErr(err); throw err; },
      );
    }
    onOk(out);
    return out;
  };
  return wrapped as unknown as F;
}

/** Wrap every method of an object so the whole plane is traced + capturable. */
export function traced<T extends object>(plane: string, target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const orig = Reflect.get(t, prop, receiver);
      if (typeof orig !== "function") return orig;
      return traceFn(plane, String(prop), orig as (...a: never[]) => unknown, t);
    },
  });
}

/** Broker-seam convenience (the original entry point). */
export function wrapWithTrace(broker: Broker): Broker {
  return traced("broker", broker);
}

/**
 * Deep structural equality over two results, used by the single-instruction CLI's
 * `--twice` mode and by re-drive replay to flag divergence. Returns the first
 * differing path, or null when identical.
 */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object mismatch`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const d = firstDifference(ao[k], bo[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
