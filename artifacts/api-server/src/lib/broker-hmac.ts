import { createHmac, createHash, randomUUID } from "node:crypto";
import { currentVersion, derivedKey } from "./key-registry";
import { deriveSessionBrokerKey, type SessionBind } from "./session-key";
import { constantTimeEqual } from "./crypto-keys";
import { sharedKv, sharedStateMode } from "./shared-state";

/**
 * Gateway↔broker request signing (security item C, folded into provenance): a detached
 * HMAC over a CANONICAL request string plus a timestamp and a single-use nonce, so the
 * broker can prove the request came from the gateway and refuse REPLAYS and STALE traffic
 * across untrusted networks. The PSK seal (lib/broker-psk) already gives in-transit
 * confidentiality + integrity; this adds replay defence and a verifiable, persistable
 * signature that doubles as the provenance MAC (same shared key).
 *
 * WHAT THE SIGNATURE COVERS (v2, audit finding F3): not just the body but the whole
 * routing-relevant surface — action, backend `source`, idempotency key, origin, the
 * timestamp, the nonce, the session binding, and a hash of the wire body. So an on-path
 * attacker can't swap `X-OmniProject-Source` to reroute a write, or strip the binding to
 * force a static-key downgrade, without invalidating the signature. A leading `v2` domain
 * tag means a signature can never be confused with any other HMAC over the same fields.
 *
 * The signing key is PER SESSION when binding material is supplied (an authenticated
 * call): `deriveSessionBrokerKey(bind)` ties the signature to one user + one session,
 * so the broker proves not just "from the gateway" but "from THIS user's valid session"
 * — and a captured signature can't be reused under another identity. System/
 * unauthenticated calls (readiness pings) sign under the static broker key.
 */

/** The routing-relevant fields the signature binds, alongside the wire body. */
export interface CanonicalRequest {
  action: string;
  source: string;
  idempotencyKey: string;
  origin: string;
  /** The exact bytes on the wire (the sealed `{v,enc}` string under PSK, else the
   *  plaintext envelope JSON) — hashed into the canonical string. */
  body: string;
}

/** Unit separator — unambiguous field boundary inside the bind sub-string (cannot
 *  appear in a `sub`/UUID/hex value). */
const US = "\x1f";

/** The (non-secret) binding rendered as a canonical sub-string, or "" for static-key
 *  calls. Bound INTO the signature so it can't be stripped/swapped on the wire. */
function bindCanonical(bind?: SessionBind): string {
  return bind ? [bind.sub, bind.smono, bind.salt, String(bind.bkver ?? "")].join(US) : "";
}

/** The v2 canonical string the HMAC is taken over. Newline-joined, `v2`-tagged, with a
 *  hash of the wire body so the string stays small and constant-size regardless of payload. */
export function brokerCanonicalString(req: CanonicalRequest, ts: number, nonce: string, bind?: SessionBind): string {
  const bodyHash = createHash("sha256").update(req.body).digest("hex");
  return ["v2", "POST", req.action, req.source, req.idempotencyKey, req.origin, String(ts), nonce, bindCanonical(bind), bodyHash].join("\n");
}

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

function sign(req: CanonicalRequest, ts: number, nonce: string, bind?: SessionBind): string {
  return createHmac("sha256", keyFor(bind)).update(brokerCanonicalString(req, ts, nonce, bind)).digest("hex");
}

/** Sign a request for the broker (fresh timestamp + nonce). When `bind` is given the
 *  signature uses that session's derived key and the binding is echoed back. */
export function signBrokerRequest(req: CanonicalRequest, bind?: SessionBind): RequestSignature {
  const ts = Date.now();
  const nonce = randomUUID();
  // Stamp the broker-key version so the binding survives a later key rotation.
  const bound = bind ? { ...bind, bkver: bind.bkver ?? currentVersion("broker") } : undefined;
  const sig = sign(req, ts, nonce, bound);
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
  input: { ts: number; nonce: string; sig: string; req: CanonicalRequest; bind?: SessionBind | undefined },
  maxAgeMs: number,
  now: number,
): VerifyResult {
  // Re-derive under the SAME key: the per-session key when bound (proving this user's
  // session signed it), else the static broker key. A binding for a different user /
  // session / broker-key version yields a different key, so the signature won't match.
  // The canonical string also binds action/source/idempotency/origin/body-hash, so a
  // swapped routing header or tampered body fails here too.
  const expected = sign(input.req, input.ts, input.nonce, input.bind);
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
  input: { ts: number; nonce: string; sig: string; req: CanonicalRequest; bind?: SessionBind | undefined },
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
  input: { ts: number; nonce: string; sig: string; req: CanonicalRequest; bind?: SessionBind | undefined },
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

// ── Response (event-channel) signature ───────────────────────────────────────────
// The broker signs its REPLY the same way the gateway signs its request, so the gateway can
// prove the response came from a master-holder and wasn't tampered on the hop (defence in depth
// on top of TLS / the PSK GCM tag). Keyed by the SAME per-session/static key the request used —
// the broker knows it from verifying the request. No nonce/replay cache: a response is bound to
// its request, so replay isn't meaningful; the timestamp bounds a captured-response injection.

export interface ResponseSignature {
  ts: number;
  sig: string;
}

/** The canonical string a response signature is taken over: a `v2resp` domain tag (distinct from
 *  the request's `v2`, so a request sig can never be replayed as a response sig), the timestamp,
 *  and a hash of the wire response body. */
export function brokerResponseCanonical(body: string, ts: number): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return ["v2resp", String(ts), bodyHash].join("\n");
}

/** Sign a broker response body under the request's key (session-bound when `bind` is given). */
export function signBrokerResponse(body: string, bind?: SessionBind): ResponseSignature {
  const ts = Date.now();
  const sig = createHmac("sha256", keyFor(bind)).update(brokerResponseCanonical(body, ts)).digest("hex");
  return { ts, sig };
}

/** Verify a broker response signature + freshness (no replay check — see the note above). */
export function verifyBrokerResponse(
  input: { body: string; ts: number; sig: string; bind?: SessionBind | undefined },
  opts: { maxAgeMs?: number; now?: number } = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now();
  const expected = createHmac("sha256", keyFor(input.bind)).update(brokerResponseCanonical(input.body, input.ts)).digest("hex");
  if (!constantTimeEqual(expected, input.sig)) return "bad-signature";
  if (Math.abs(now - input.ts) > maxAgeMs) return "expired";
  return "ok";
}

/** Test-only: clear the in-process replay cache. */
export function __resetBrokerHmac(): void {
  seen.clear();
}
