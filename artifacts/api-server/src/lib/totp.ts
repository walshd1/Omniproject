/**
 * TOTP (RFC 6238) for app-native two-factor auth — a thin wrapper over the audited, widely-used `otpauth`
 * library (itself backed by `@noble/hashes`). We deliberately do NOT hand-roll the crypto (base32, HMAC, the
 * RFC 4226 dynamic truncation): that primitive is exactly the kind of thing that's subtly easy to get wrong,
 * so it lives in a vetted dependency, the same posture as `jose`/`openid-client` elsewhere in the gateway.
 *
 * This module only adds a small, stable interface the enrol/verify routes and the settings panel build on,
 * and keeps recovery-code generation (plain CSPRNG randomness, not an OTP primitive) local. Everything here
 * is still a pure function of its inputs, so it's verified against the RFC 6238 test vectors in totp.test.ts.
 */
import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";

/** Clean an incoming base32 string (case/space/padding tolerant) before handing it to the library. */
function cleanB32(str: string): string {
  return (str ?? "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
}

/** Encode bytes as unpadded RFC 4648 base32 (the authenticator secret form) via the library. */
export function base32Encode(buf: Buffer): string {
  return new OTPAuth.Secret({ buffer: new Uint8Array(buf).buffer }).base32;
}

/** Decode an (optionally spaced/padded, any-case) base32 string to bytes via the library. */
export function base32Decode(str: string): Buffer {
  return Buffer.from(OTPAuth.Secret.fromBase32(cleanB32(str)).bytes);
}

export interface TotpParams {
  /** Code length (default 6). */
  digits?: number;
  /** Time step in seconds (default 30). */
  period?: number;
  /** HMAC hash (default SHA1, the near-universal authenticator default). */
  algorithm?: "SHA1" | "SHA256" | "SHA512";
}

/** Build a configured otpauth TOTP for a base32 secret. */
function totp(secretB32: string, p: TotpParams = {}, meta: { issuer?: string; label?: string } = {}): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    ...(meta.issuer !== undefined ? { issuer: meta.issuer } : {}),
    ...(meta.label !== undefined ? { label: meta.label } : {}),
    algorithm: p.algorithm ?? "SHA1",
    digits: p.digits ?? 6,
    period: p.period ?? 30,
    secret: OTPAuth.Secret.fromBase32(cleanB32(secretB32)),
  });
}

/** The TOTP code for a base32 secret at a given unix time (seconds). */
export function totpCode(secretB32: string, timeSec: number, p: TotpParams = {}): string {
  return totp(secretB32, p).generate({ timestamp: timeSec * 1000 });
}

/**
 * Verify a presented code against the secret at `timeSec`, accepting ±`window` steps (default 1 → tolerates
 * ~30s of clock skew each way). The library does the constant-time comparison across the window; we reject a
 * malformed code (wrong length / non-digits) up front so `validate` only ever sees a well-formed token.
 */
export function verifyTotp(secretB32: string, code: string, timeSec: number, p: TotpParams & { window?: number } = {}): boolean {
  const digits = p.digits ?? 6;
  const presented = (code ?? "").replace(/\s+/g, "");
  if (presented.length !== digits || !/^\d+$/.test(presented)) return false;
  const delta = totp(secretB32, p).validate({ token: presented, timestamp: timeSec * 1000, window: p.window ?? 1 });
  return delta !== null;
}

/** A fresh random base32 TOTP secret (default 160 bits, per RFC 6238's recommendation). */
export function generateTotpSecret(bytes = 20): string {
  return new OTPAuth.Secret({ size: bytes }).base32;
}

/** The `otpauth://` provisioning URI an authenticator app scans as a QR code. */
export function otpauthUrl(o: { secret: string; account: string; issuer: string; digits?: number; period?: number; algorithm?: "SHA1" | "SHA256" | "SHA512" }): string {
  const p: TotpParams = {
    ...(o.digits !== undefined ? { digits: o.digits } : {}),
    ...(o.period !== undefined ? { period: o.period } : {}),
    ...(o.algorithm !== undefined ? { algorithm: o.algorithm } : {}),
  };
  return totp(o.secret, p, { issuer: o.issuer, label: o.account }).toString();
}

/** N single-use recovery codes (grouped, lower-case) that bypass TOTP when a device is lost. Generated from
 *  the CSPRNG (`crypto.randomBytes`); the caller stores only their HASHES (see the store slice). */
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
