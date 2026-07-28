/**
 * TOTP (RFC 6238) — the pure, dependency-free crypto core for app-native two-factor auth. Everything here is
 * a pure function of its inputs (secret, time, code), so it's exhaustively testable against the RFC's own
 * vectors and carries no storage/session/route concerns — those live in the store + route slices on top.
 *
 * A TOTP is an HOTP (RFC 4226) keyed by a 30-second time counter: HMAC-SHA1 of the counter under the shared
 * secret, dynamically truncated to N digits. An authenticator app (Google Authenticator, 1Password, …) holds
 * the same base32 secret and shows the same rolling code; we verify a presented code within a small time
 * window, in constant time.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 4648 base32 alphabet (no padding — otpauth secrets are unpadded). */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes as unpadded RFC 4648 base32 (the form authenticator apps expect for the shared secret). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an (optionally spaced/padded, any-case) base32 string to bytes. Throws on an invalid character. */
export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export interface TotpParams {
  /** Code length (default 6). */
  digits?: number;
  /** Time step in seconds (default 30). */
  period?: number;
  /** HMAC hash (default SHA1, the near-universal authenticator default). */
  algorithm?: "SHA1" | "SHA256" | "SHA512";
}

/** The HOTP value for a specific counter — HMAC(secret, counter) then RFC 4226 dynamic truncation. */
function hotp(secret: Buffer, counter: bigint, digits: number, algorithm: string): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** The TOTP code for a base32 secret at a given unix time (seconds). */
export function totpCode(secretB32: string, timeSec: number, p: TotpParams = {}): string {
  const digits = p.digits ?? 6;
  const period = p.period ?? 30;
  const algorithm = (p.algorithm ?? "SHA1").toLowerCase();
  const counter = BigInt(Math.floor(timeSec / period));
  return hotp(base32Decode(secretB32), counter, digits, algorithm);
}

/**
 * Verify a presented code against the secret at `timeSec`, accepting ±`window` steps (default 1 → tolerates
 * ~30s of clock skew each way). Comparison is constant-time. A malformed code (wrong length / non-digits)
 * is rejected up front.
 */
export function verifyTotp(secretB32: string, code: string, timeSec: number, p: TotpParams & { window?: number } = {}): boolean {
  const digits = p.digits ?? 6;
  const period = p.period ?? 30;
  const window = p.window ?? 1;
  const algorithm = (p.algorithm ?? "SHA1").toLowerCase();
  const presented = (code ?? "").replace(/\s+/g, "");
  if (presented.length !== digits || !/^\d+$/.test(presented)) return false;
  const secret = base32Decode(secretB32);
  const base = Math.floor(timeSec / period);
  const want = Buffer.from(presented);
  let ok = false;
  // Check every step in the window (no early return) so timing doesn't leak which step matched.
  for (let i = -window; i <= window; i++) {
    const got = Buffer.from(hotp(secret, BigInt(base + i), digits, algorithm));
    if (got.length === want.length && timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}

/** A fresh random base32 TOTP secret (default 160 bits, per RFC 6238's recommendation). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** The `otpauth://` provisioning URI an authenticator app scans as a QR code. */
export function otpauthUrl(o: { secret: string; account: string; issuer: string; digits?: number; period?: number; algorithm?: string }): string {
  const label = `${encodeURIComponent(o.issuer)}:${encodeURIComponent(o.account)}`;
  const params = new URLSearchParams({
    secret: o.secret,
    issuer: o.issuer,
    algorithm: o.algorithm ?? "SHA1",
    digits: String(o.digits ?? 6),
    period: String(o.period ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** N single-use recovery codes (grouped, lower-case base32) that bypass TOTP when a device is lost. The
 *  caller stores only their HASHES (see the store slice); these plaintext codes are shown to the user once. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(10)).slice(0, 16).toLowerCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

/** Normalise a recovery code for comparison (strip spacing/dashes, lower-case) so display grouping is ignored. */
export function normalizeRecoveryCode(code: string): string {
  return (code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
