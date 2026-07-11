import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { deriveKey, deriveKeyCached } from "./crypto-keys";

/**
 * Opt-in pre-shared-key (PSK) encryption for the broker hop — a *fallback below
 * TLS*, not a replacement for it.
 *
 * THE HONEST HIERARCHY (read this before turning it on):
 *   1. **TLS is the right answer.** Set `BROKER_URL` to `https://` and the whole
 *      hop — body, the user's Authorization token, every header — is encrypted
 *      and the broker's certificate is authenticated. Use a private-CA bundle via
 *      `NODE_EXTRA_CA_CERTS`. Do this first. See docs/ops/EGRESS-INVENTORY.md §3b.
 *   2. **PSK is for when you genuinely cannot run TLS** on the hop (e.g. a legacy
 *      broker on a trusted-but-plaintext segment, and you still want a `tcpdump`
 *      to see ciphertext rather than the bearer token in cleartext). It encrypts
 *      the ENTIRE request envelope — action, payload AND the forwarded auth token
 *      — with AES-256-GCM under a shared key, so a packet capture sees only
 *      opaque ciphertext + an `enc` marker.
 *
 * What PSK does NOT give you (and TLS does):
 *   - **No forward secrecy** — one static key; if it leaks, past captures decrypt.
 *   - **No peer authentication** — anyone with the key is "the broker"; no cert.
 *   - **Metadata still leaks** — destination IP, port, packet sizes and timing
 *     are visible (true of TLS too, but TLS at least authenticates the peer).
 *   - **The broker MUST implement the matching crypto** (the reference sidecar
 *     does — see broker/reference-sidecar.ts — so it is real and tested).
 *
 * Crypto: AES-256-GCM (authenticated — tampering fails the tag), random 96-bit
 * IV per message, versioned token. Read lazily so a key change takes effect
 * without a restart.
 *
 * KEY DERIVATION — two versions on the wire:
 *   - `p2.` (current) derives the key with HKDF-SHA256 and a domain-separation
 *     label (`deriveKey(BROKER_PSK, "broker-psk/v2")`), so the broker key can
 *     never collide with a key minted from the same secret for another use.
 *   - `p1.` (legacy) derived the key as a bare `SHA-256(BROKER_PSK)`. Still
 *     OPENED for backward compatibility, but nothing SEALS `p1.` any more.
 * A `tcpdump` on a PSK'd hop therefore sees only opaque ciphertext + a version
 * marker either way; v2 just closes the key-collision gap (audit finding F1).
 */

const PREFIX = "p2."; // current version — HKDF domain-separated key
const LEGACY_PREFIX = "p1."; // openable-only: bare SHA-256(secret) key
const PSK_INFO = "broker-psk/v2"; // HKDF domain-separation label for the broker seam

/** The raw shared key from the environment, or undefined when PSK is off. */
function rawPsk(): string | undefined {
  return process.env["BROKER_PSK"]?.trim() || undefined;
}

/** True when an operator has opted into app-layer broker encryption. */
export function pskEnabled(): boolean {
  return !!rawPsk();
}

/** The v2 (HKDF, domain-separated) key. */
function key(): Buffer {
  const secret = rawPsk();
  if (!secret) throw new Error("BROKER_PSK is not set");
  return deriveKey(secret, PSK_INFO);
}

/** The legacy v1 key (bare SHA-256) — only to OPEN pre-migration `p1.` tokens. */
function legacyKey(): Buffer {
  const secret = rawPsk();
  if (!secret) throw new Error("BROKER_PSK is not set");
  return deriveKeyCached(secret);
}

/** Encrypt + authenticate a string. Returns a versioned base64url token (`p2.`). */
export function sealPayload(plaintext: string): string {
  return PREFIX + aesGcmSeal(plaintext, key());
}

/** Decrypt + verify. Accepts the current `p2.` token and the legacy `p1.` token
 *  (opened under the old bare-SHA-256 key). Returns null on a non-sealed value,
 *  tamper, or wrong key — never throws, so a caller can treat any failure as a
 *  bad request. */
export function openPayload(token: string): string | null {
  if (typeof token !== "string") return null;
  if (token.startsWith(PREFIX)) return aesGcmOpen(token.slice(PREFIX.length), key());
  if (token.startsWith(LEGACY_PREFIX)) return aesGcmOpen(token.slice(LEGACY_PREFIX.length), legacyKey());
  return null;
}

/** The marker header set on an encrypted request so a broker can route/detect it
 *  without parsing the body. Carries only the format version — no secret. */
export const PSK_HEADER = "X-OmniProject-Enc";
export const PSK_PREFIX = PREFIX;
