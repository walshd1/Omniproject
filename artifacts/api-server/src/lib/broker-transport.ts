import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { decodePemOrBase64 } from "./pem";

/**
 * The broker HTTP transport — a custom dispatcher shared by every call to the broker, and a
 * `fetch()` that's guaranteed to actually accept it.
 *
 * Two independent wins, one dispatcher, because both require the same custom undici Agent (the
 * WHATWG fetch spec has no hook for either):
 *
 *  - WARM CONNECTIONS: a persistent, tuned keep-alive Agent lets consecutive broker calls reuse
 *    one TCP+TLS connection instead of paying a fresh handshake each time (Node's default global
 *    dispatcher already keeps connections alive, but only for 4s of idle time — too short for a
 *    gateway that calls the broker in bursts separated by user think-time).
 *  - MUTUAL TLS: when BROKER_MTLS_CERT/KEY (+ optional BROKER_MTLS_CA) are set, the gateway
 *    presents a client certificate and/or verifies the broker against a private CA — defence in
 *    depth on top of the existing per-request HMAC/PSK signing (lib/broker-hmac.ts,
 *    lib/broker-psk.ts), which protects the payload but not the transport identity of either
 *    side. Off (plain TLS, system CAs) unless configured — wiring this changes nothing until an
 *    operator opts in.
 *
 * `brokerFetch` (NOT the global `fetch`) is the only way this dispatcher is used: Node's global
 * fetch is powered by whatever undici version ships INSIDE that Node release, which routinely
 * lags the `undici` package installed from npm. Handing a same-package-mismatched `Agent` to
 * Node's global fetch throws at request time (`InvalidArgumentError: invalid onRequestStart
 * method`) — the two versions' internal dispatch-handler protocols aren't wire-compatible, even
 * though their TypeScript types look identical. Calling undici's OWN `fetch` with undici's OWN
 * `Agent` (same package, same version, always) sidesteps the mismatch entirely.
 */

interface TlsConnectOptions {
  cert?: string;
  key?: string;
  ca?: string;
  rejectUnauthorized: boolean;
}

function tlsOptions(): TlsConnectOptions {
  const cert = decodePemOrBase64(process.env["BROKER_MTLS_CERT"], "BEGIN CERTIFICATE", true) ?? undefined;
  const key = decodePemOrBase64(process.env["BROKER_MTLS_KEY"], "PRIVATE KEY", true) ?? undefined;
  const ca = decodePemOrBase64(process.env["BROKER_MTLS_CA"], "BEGIN CERTIFICATE", true) ?? undefined;
  return {
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
    ...(ca ? { ca } : {}),
    // Fail-closed by default. BROKER_MTLS_INSECURE is an explicit, narrow escape hatch for
    // testing against a broker with a self-signed cert; security-check.ts refuses to boot
    // with it set in a production-like environment (see lib/security-check.ts).
    rejectUnauthorized: process.env["BROKER_MTLS_INSECURE"] !== "true",
  };
}

/** True when the gateway presents a client certificate to the broker (mTLS engaged). */
export function brokerMtlsConfigured(): boolean {
  const t = tlsOptions();
  return !!(t.cert && t.key);
}

/** The shared broker dispatcher (lazily built, cached across calls) plus the TLS options it
 *  was built from — so a config change is detected from the SAME value used to build the
 *  Agent, rather than a second, independently-maintained list of the same env vars. */
let cached: { agent: Agent; tls: TlsConnectOptions } | null = null;

const sameTls = (a: TlsConnectOptions, b: TlsConnectOptions): boolean =>
  a.cert === b.cert && a.key === b.key && a.ca === b.ca && a.rejectUnauthorized === b.rejectUnauthorized;

/** The shared broker dispatcher (lazily built, cached across calls). */
export function brokerDispatcher(): Agent {
  const tls = tlsOptions();
  if (cached && sameTls(cached.tls, tls)) return cached.agent;
  if (cached) void cached.agent.close().catch(() => {});
  const agent = new Agent({
    // Idle connections survive between bursts of broker traffic (a user's dashboard load
    // fires several calls, then nothing for tens of seconds) instead of reconnecting each time.
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    // Per-origin socket cap — generous enough for the verify-probe fan-out
    // (VERIFY_PROBE_FANOUT_LIMIT concurrent probes) without opening unbounded sockets.
    connections: 32,
    connect: tls,
  });
  cached = { agent, tls };
  return agent;
}

/** Close the cached dispatcher (graceful shutdown; also test-only reset-between-toggles). */
export async function closeBrokerDispatcher(): Promise<void> {
  if (!cached) return;
  const agent = cached.agent;
  cached = null;
  await agent.close().catch(() => {});
}

/** `fetch()` to the broker: undici's own implementation, wired to the shared dispatcher above.
 *  See the module comment for why this — not the global `fetch` — is required. */
export function brokerFetch(url: string, init: UndiciRequestInit): ReturnType<typeof undiciFetch> {
  return undiciFetch(url, { ...init, dispatcher: brokerDispatcher() });
}
