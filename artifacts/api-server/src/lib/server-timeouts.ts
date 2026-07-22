/**
 * Inbound HTTP-server hardening (slowloris / slow-body defence).
 *
 * Node's listener defaults are generous (headers 60s, request 300s), and nothing caps concurrent sockets — so a
 * slow-drip flood can tie up connections. These bounds apply to REQUEST RECEIPT, not the response, so long-lived
 * SSE responses are unaffected (their request is received instantly; only the response streams). All are
 * env-tunable; `MAX_CONNECTIONS` is opt-in (unset ⇒ Node's unlimited default, so existing deployments are
 * unchanged unless the operator sets a cap).
 */

type Env = Record<string, string | undefined>;

/** The subset of http.Server we set — kept structural so this is trivially unit-testable. */
export interface TimeoutTarget {
  requestTimeout?: number;
  headersTimeout?: number;
  keepAliveTimeout?: number;
  maxConnections?: number;
}

function envInt(env: Env, key: string, dflt: number): number {
  const n = Number(env[key]?.trim());
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

/** Apply the inbound-HTTP hardening timeouts (slowloris defence) to a live server: request/headers/keep-alive
 *  windows from env with safe defaults, and an opt-in max-connection cap. Mutates `server` in place. */
export function configureServerTimeouts(server: TimeoutTarget, env: Env = process.env): void {
  // Time to receive the whole request (slow-body slowloris). 30s is ample for a ≤256kb body on a slow link.
  server.requestTimeout = envInt(env, "REQUEST_TIMEOUT_MS", 30_000);
  // Time to receive the request HEADERS (slow-header slowloris). Must be ≥ keepAliveTimeout to avoid a
  // premature 502 behind a keep-alive proxy — 15s > 10s below.
  server.headersTimeout = envInt(env, "HEADERS_TIMEOUT_MS", 15_000);
  // Idle time a keep-alive socket is held open between requests before the server closes it.
  server.keepAliveTimeout = envInt(env, "KEEPALIVE_TIMEOUT_MS", 10_000);
  // Optional hard cap on concurrent accepted sockets — a global backstop against socket exhaustion. Opt-in:
  // unset leaves Node's unlimited default so a high-fan-in (many-SSE) deployment isn't silently throttled.
  const maxConn = env["MAX_CONNECTIONS"]?.trim();
  if (maxConn) {
    const n = Number(maxConn);
    if (Number.isInteger(n) && n > 0) server.maxConnections = n;
  }
}
