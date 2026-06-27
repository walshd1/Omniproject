import { logger } from "../lib/logger";
import { BrokerError, type Broker } from "./types";

/**
 * Broker trace decorator — a developer aid that makes the seam observable at the
 * METHOD boundary. It wraps any `Broker` in a Proxy and logs every call
 * (`→ method`, `← method` with timing, `✗ method` on failure) through the shared
 * pino logger, so you can see exactly which of the ~25 broker methods ran, in what
 * order, with what shape — and where a code path diverges.
 *
 * Unlike the admin broker-log ring (lib/broker-log.ts), which records HTTP-level
 * *actions* for an operator, this traces the neutral `Broker` interface itself —
 * the layer a contributor debugs. Being a Proxy, it needs no per-method wiring and
 * automatically covers methods added to the interface later.
 *
 * STRONGLY GATED — this is shipped but inert in production:
 *  - `debugAllowed()` is false whenever NODE_ENV=production, so nothing traces in a
 *    released deployment regardless of other flags (a CI guard asserts this).
 *  - Off by default; opt in with BROKER_TRACE=1 on a non-production build.
 *  - Redaction by default: credentials (token/authHeader/cookie/psk/…) are NEVER
 *    emitted, and arg/result VALUES are summarised to their shape only. Full
 *    payloads (still secret-scrubbed) require a SECOND explicit non-prod flag,
 *    BROKER_TRACE_PAYLOADS=1, because real payloads carry backend PII.
 */

const log = logger.child({ mod: "broker-trace" });

/** Debug surfaces are inert in production, full stop. */
export function debugAllowed(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

/** Is method-boundary tracing active? (Non-prod + opt-in.) */
export function traceEnabled(): boolean {
  return debugAllowed() && process.env["BROKER_TRACE"] === "1";
}

/** May we emit full (secret-scrubbed) payloads, not just shapes? (Non-prod + a 2nd flag.) */
export function payloadsEnabled(): boolean {
  return debugAllowed() && process.env["BROKER_TRACE_PAYLOADS"] === "1";
}

/** Keys whose values are never emitted, at any depth, in any mode. */
const SECRET_KEYS = new Set(["token", "authheader", "authorization", "cookie", "psk", "password", "secret", "apikey", "api_key"]);

/** A structural descriptor — types/keys/lengths, NO values. The default view. */
export function shape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  const t = typeof value;
  if (t !== "object") return t; // "string" | "number" | "boolean" | …
  return `object{${Object.keys(value as object).sort().join(",")}}`;
}

/** Full values with secret keys masked and arrays bounded. Only used with payloads on. */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return shape(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactDeep(v, depth + 1);
  }
  return out;
}

/** Render a value for the trace line per the current mode. */
function view(value: unknown): unknown {
  return payloadsEnabled() ? redactDeep(value) : shape(value);
}

/** A compact, leak-free error projection (BrokerError code preferred). */
function errView(err: unknown): Record<string, unknown> {
  if (err instanceof BrokerError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: shape(err) };
}

/**
 * Wrap a broker so every method call is traced. Pure decoration: the return value
 * (and any throw/rejection) is passed through untouched — observation only.
 */
export function wrapWithTrace(broker: Broker): Broker {
  return new Proxy(broker, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);
      return function (this: unknown, ...args: unknown[]) {
        const started = Date.now();
        log.debug({ method, args: args.map(view) }, `→ ${method}`);
        const finish = (result: unknown) => log.debug({ method, ms: Date.now() - started, result: view(result) }, `← ${method}`);
        const fail = (err: unknown) => log.warn({ method, ms: Date.now() - started, err: errView(err) }, `✗ ${method}`);
        let out: unknown;
        try {
          out = (orig as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          fail(err);
          throw err;
        }
        if (out && typeof (out as Promise<unknown>).then === "function") {
          return (out as Promise<unknown>).then(
            (val) => { finish(val); return val; },
            (err) => { fail(err); throw err; },
          );
        }
        finish(out);
        return out;
      };
    },
  }) as Broker;
}

/**
 * Deep structural equality over two results, used by the single-instruction CLI's
 * `--twice` mode to flag a non-idempotent path (the same instruction sent twice
 * should, for reads, return the same thing). Returns the first differing path, or
 * null when identical.
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
