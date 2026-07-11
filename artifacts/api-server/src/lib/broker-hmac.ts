import { createHmac, randomUUID } from "node:crypto";
import { currentVersion, derivedKey } from "./key-registry";
import { deriveSessionBrokerKey, type SessionBind } from "./session-key";
import { constantTimeEqual } from "./crypto-keys";

/**
 * Gateway↔broker request signing (security item C, folded into provenance): a detached
 * HMAC over the request body plus a timestamp and a single-use nonce, so the broker can
 * prove the request came from the gateway and refuse REPLAYS and STALE traffic across
 * untrusted networks. The PSK seal (lib/broker-psk) already gives in-transit
 * confidentiality + integrity; this adds replay defence and a verifiable, persistable
 * signature that doubles as the provenance MAC (same shared key).
 *
 * The signing key is PER SESSION when binding material is supplied (an authenticated
 * call): `deriveSessionBrokerKey(bind)` ties the signature to one user + one session,
 * so the broker proves not just "from the gateway" but "from THIS user's valid session"
 * — and a captured signature can't be reused under another identity. System/
 * unauthenticated calls (readiness pings) sign under the static broker key.
 */

/** The signing key: per-session when bound, else the static (revocable) broker key. */
function keyFor(bind?: SessionBind): string {
  return bind ? deriveSessionBrokerKey(bind) : derivedKey("broker");
}

export interface RequestSignature {
  ts: number;
  nonce: string;
  sig: string;
  /** The (non-secret) binding the broker needs to re-derive the per-session key.
   *  Echoed back so the caller can put it on the wire. Absent for static-key calls. */
  bind?: SessionBind;
}

function sign(ts: number, nonce: string, body: string, bind?: SessionBind): string {
  return createHmac("sha256", keyFor(bind)).update(`${ts}.${nonce}.${body}`).digest("hex");
}

/** Sign a request body for the broker (fresh timestamp + nonce). When `bind` is given
 *  the signature uses that session's derived key and the binding is echoed back. */
export function signBrokerRequest(body: string, bind?: SessionBind): RequestSignature {
  const ts = Date.now();
  const nonce = randomUUID();
  // Stamp the broker-key version so the binding survives a later key rotation.
  const bound = bind ? { ...bind, bkver: bind.bkver ?? currentVersion("broker") } : undefined;
  const sig = sign(ts, nonce, body, bound);
  return bound ? { ts, nonce, sig, bind: bound } : { ts, nonce, sig };
}

export type VerifyResult = "ok" | "expired" | "replay" | "bad-signature";

// Seen-nonce cache (in-memory, RAM-only). Entries expire with the freshness window.
//
// SCOPE (honest): this cache lives in the process that RUNS the verifier — the out-of-process
// broker/backend, not the gateway (the gateway only signs). It is therefore per-verifier-process:
// under a single broker instance replay defence is exact (the has→set critical section is fully
// synchronous — no await between check and mark — so concurrent verifies can't both miss). Under a
// horizontally-scaled broker WITHOUT sticky routing, a replay routed to a different broker replica
// than the original finds no nonce and is accepted; the signature + freshness-window checks still
// hold, so this weakens replay defence, it does not remove authentication. A fleet-wide nonce store
// belongs in the broker's own shared cache, not here — this gateway module deliberately keeps the
// seam's verify contract synchronous and dependency-free rather than reaching across it.
const seen = new Map<string, number>();
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

function pruneSeen(now: number, maxAgeMs: number): void {
  for (const [nonce, ts] of seen) if (now - ts > maxAgeMs) seen.delete(nonce);
}

/**
 * Verify a signed broker request: signature matches, timestamp is within the freshness
 * window, and the nonce hasn't been used (replay). The broker calls this; we test it.
 */
export function verifyBrokerRequest(
  input: { ts: number; nonce: string; sig: string; body: string; bind?: SessionBind },
  opts: { maxAgeMs?: number; now?: number } = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now();

  // Re-derive under the SAME key: the per-session key when bound (proving this user's
  // session signed it), else the static broker key. A binding for a different user /
  // session / broker-key version yields a different key, so the signature won't match.
  const expected = sign(input.ts, input.nonce, input.body, input.bind);
  if (!constantTimeEqual(expected, input.sig)) return "bad-signature";

  if (Math.abs(now - input.ts) > maxAgeMs) return "expired";

  pruneSeen(now, maxAgeMs);
  if (seen.has(input.nonce)) return "replay";
  seen.set(input.nonce, now);
  return "ok";
}

/** Test-only: clear the replay cache. */
export function __resetBrokerHmac(): void {
  seen.clear();
}
