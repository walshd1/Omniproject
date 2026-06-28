import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { derivedKey } from "./key-registry";

/**
 * Gateway↔broker request signing (security item C, folded into provenance): a detached
 * HMAC over the request body plus a timestamp and a single-use nonce, so the broker can
 * prove the request came from the gateway and refuse REPLAYS and STALE traffic across
 * untrusted networks. The PSK seal (lib/broker-psk) already gives in-transit
 * confidentiality + integrity; this adds replay defence and a verifiable, persistable
 * signature that doubles as the provenance MAC (same shared key).
 */
function key(): string {
  // The broker signing key from the revocable key registry (rotates on revoke).
  return derivedKey("broker");
}

export interface RequestSignature {
  ts: number;
  nonce: string;
  sig: string;
}

function sign(ts: number, nonce: string, body: string): string {
  return createHmac("sha256", key()).update(`${ts}.${nonce}.${body}`).digest("hex");
}

/** Sign a request body for the broker (fresh timestamp + nonce). */
export function signBrokerRequest(body: string): RequestSignature {
  const ts = Date.now();
  const nonce = randomUUID();
  return { ts, nonce, sig: sign(ts, nonce, body) };
}

export type VerifyResult = "ok" | "expired" | "replay" | "bad-signature";

// Seen-nonce cache (in-memory, RAM-only). Entries expire with the freshness window.
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
  input: { ts: number; nonce: string; sig: string; body: string },
  opts: { maxAgeMs?: number; now?: number } = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now();

  const expected = sign(input.ts, input.nonce, input.body);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad-signature";

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
