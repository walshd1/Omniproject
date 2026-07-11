import { createHmac, randomUUID } from "node:crypto";
import { currentVersion, derivedKey } from "./key-registry";
import { deriveSessionBrokerKey, type SessionBind } from "./session-key";
import { constantTimeEqual } from "./crypto-keys";
import { sharedKv, sharedStateMode } from "./shared-state";

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

// Seen-nonce cache (in-memory). Entries expire with the freshness window.
//
// SCOPE: this cache lives in the process that RUNS the verifier (the broker/backend — the gateway
// only signs). The IN-PROCESS path below is exact under a single verifier instance: the has→set
// critical section is fully synchronous (no await between check and mark), so concurrent verifies
// can't both miss. It is per-process, so a horizontally-scaled broker WITHOUT sticky routing could
// accept a replay routed to a different replica than the original. For that topology use the
// Redis-gated `verifyBrokerRequestShared` below, which claims the nonce in the SHARED-STATE seam
// (fleet-wide across replicas). The default (no Redis) stays fully in-process — the statelessness
// posture is preserved; Redis is the opt-in that upgrades replay defence to fleet scope, exactly
// like session-registry / rate-limit / SAML replay.
const seen = new Map<string, number>();
const DEFAULT_MAX_AGE_MS = 5 * 60_000;
const NONCE_KEY = (nonce: string) => `brk:nonce:${nonce}`;

function pruneSeen(now: number, maxAgeMs: number): void {
  for (const [nonce, ts] of seen) if (now - ts > maxAgeMs) seen.delete(nonce);
}

/** Record a nonce as seen in the in-process cache; returns true when it was FRESH (first use).
 *  Synchronous — the prune/has/set critical section has no await, so it serialises concurrent
 *  callers within this process. */
function recordNonceLocal(nonce: string, now: number, maxAgeMs: number): boolean {
  pruneSeen(now, maxAgeMs);
  if (seen.has(nonce)) return false;
  seen.set(nonce, now);
  return true;
}

/** Signature + freshness (the pure, I/O-free half of verification). Returns "ok" when both hold,
 *  else the failing verdict — the caller then applies its replay check. */
function verifySigAndFreshness(
  input: { ts: number; nonce: string; sig: string; body: string; bind?: SessionBind },
  maxAgeMs: number,
  now: number,
): VerifyResult {
  // Re-derive under the SAME key: the per-session key when bound (proving this user's
  // session signed it), else the static broker key. A binding for a different user /
  // session / broker-key version yields a different key, so the signature won't match.
  const expected = sign(input.ts, input.nonce, input.body, input.bind);
  if (!constantTimeEqual(expected, input.sig)) return "bad-signature";
  if (Math.abs(now - input.ts) > maxAgeMs) return "expired";
  return "ok";
}

/**
 * Verify a signed broker request: signature matches, timestamp is within the freshness window, and
 * the nonce hasn't been used (replay), against the IN-PROCESS nonce cache. Synchronous and
 * dependency-free — the stateless single-verifier default. For a horizontally-scaled broker use
 * `verifyBrokerRequestShared`. The broker calls this; we test it.
 */
export function verifyBrokerRequest(
  input: { ts: number; nonce: string; sig: string; body: string; bind?: SessionBind },
  opts: { maxAgeMs?: number; now?: number } = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now();
  const pre = verifySigAndFreshness(input, maxAgeMs, now);
  if (pre !== "ok") return pre;
  return recordNonceLocal(input.nonce, now, maxAgeMs) ? "ok" : "replay";
}

/**
 * Fleet-aware verify. Signature + freshness are identical to `verifyBrokerRequest`; only the replay
 * check differs: when the shared-state seam is Redis-backed, the nonce is claimed with an atomic
 * compare-and-set in that shared store, so a replay routed to ANY broker replica is rejected
 * (fleet-wide). Without Redis it falls back to the in-process cache — byte-identical to
 * `verifyBrokerRequest`, so the stateless single-replica default is unchanged. Signature and
 * freshness are checked BEFORE any shared-store I/O, so a bad/stale request never touches Redis.
 */
export async function verifyBrokerRequestShared(
  input: { ts: number; nonce: string; sig: string; body: string; bind?: SessionBind },
  opts: { maxAgeMs?: number; now?: number } = {},
): Promise<VerifyResult> {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now();
  const pre = verifySigAndFreshness(input, maxAgeMs, now);
  if (pre !== "ok") return pre;
  if (sharedStateMode() === "redis") {
    // cas(key, null, …) = set-only-if-absent, atomic across replicas — first claim wins, a replay
    // finds the key present and is rejected. TTL matches the freshness window (self-pruning).
    const won = await sharedKv.cas(NONCE_KEY(input.nonce), null, "1", { ttlMs: maxAgeMs });
    return won ? "ok" : "replay";
  }
  return recordNonceLocal(input.nonce, now, maxAgeMs) ? "ok" : "replay";
}

/** Test-only: clear the in-process replay cache. */
export function __resetBrokerHmac(): void {
  seen.clear();
}
