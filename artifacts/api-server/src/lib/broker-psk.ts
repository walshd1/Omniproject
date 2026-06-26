import crypto from "node:crypto";

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
 * Crypto: AES-256-GCM (authenticated — tampering fails the tag), key =
 * SHA-256(BROKER_PSK), random 96-bit IV per message, versioned `p1.` token.
 * Identical to the session-cookie sealing (lib/session-crypto.ts); a separate
 * key and prefix keep the two domains independent. Read lazily so a key change
 * takes effect without a restart.
 */

const PREFIX = "p1."; // version marker so the wire format can evolve / migrate

let cache: { secret: string; key: Buffer } | null = null;

/** The raw shared key from the environment, or undefined when PSK is off. */
function rawPsk(): string | undefined {
  return process.env["BROKER_PSK"]?.trim() || undefined;
}

/** True when an operator has opted into app-layer broker encryption. */
export function pskEnabled(): boolean {
  return !!rawPsk();
}

function key(): Buffer {
  const secret = rawPsk();
  if (!secret) throw new Error("BROKER_PSK is not set");
  if (!cache || cache.secret !== secret) {
    cache = { secret, key: crypto.createHash("sha256").update(secret).digest() };
  }
  return cache.key;
}

/** Encrypt + authenticate a string. Returns a versioned base64url token. */
export function sealPayload(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Decrypt + verify. Returns null on a non-sealed value, tamper, or wrong key —
 *  never throws, so the broker/gateway can treat any failure as a bad request. */
export function openPayload(token: string): string | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(token.slice(PREFIX.length), "base64url");
    if (buf.length < 28) return null; // 12 IV + 16 tag minimum
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The marker header set on an encrypted request so a broker can route/detect it
 *  without parsing the body. Carries only the format version — no secret. */
export const PSK_HEADER = "X-OmniProject-Enc";
export const PSK_PREFIX = PREFIX;
