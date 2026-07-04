import { randomBytes } from "node:crypto";
import { seal, open } from "./session-crypto";
import { sharedKv } from "./shared-state";
import { isOidcConfigured } from "./oidc";
import { isSamlConfigured } from "./saml";
import { sendEmail } from "./email";
import { logger } from "./logger";

/**
 * Magic-link / email-OTP — passwordless sign-in for orgs with NO IdP (the charity/SME / homelab
 * who haven't wired OIDC or SAML and don't want a directory). The user enters an email, gets a
 * one-time link, and clicking it mints the SAME signed session cookie as every other auth path.
 *
 * Security model (no new storage):
 *  - The token is a SEALED (AES-256-GCM, tamper-evident) payload {email, exp, jti} via
 *    lib/session-crypto — it is self-verifying and carries no server-side secret; a tampered or
 *    wrong-key token decrypts to null.
 *  - Single-use is enforced by recording the `jti` in the shared-state seam with a TTL on first
 *    verify (fleet-wide when Redis is configured); a replay finds the marker and is rejected.
 *
 * OFF by default and only available when there's no real SSO: enable with `MAGIC_LINK_ENABLED=true`
 * AND neither OIDC nor SAML configured (real SSO always wins). The request endpoint is rate-limited
 * (the shared loginLimiter). Email delivery is via `SMTP_URL` (lib/email.ts) when set; unset, it
 * falls back to logging the link for the operator/dev to relay by hand.
 */

export function magicLinkEnabled(): boolean {
  return process.env["MAGIC_LINK_ENABLED"]?.trim().toLowerCase() === "true" && !isOidcConfigured && !isSamlConfigured();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A lightweight, dependency-free email shape check (not RFC-exhaustive) bounded to 254 chars. */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim()) && email.trim().length <= 254;
}

function ttlMs(): number {
  const m = Number(process.env["MAGIC_LINK_TTL_MINUTES"]);
  return (Number.isFinite(m) && m > 0 ? m : 15) * 60 * 1000;
}

interface MagicPayload { email: string; exp: number; jti: string }

/** Mint a sealed, single-use, time-boxed magic token for an email. */
export function mintMagicToken(email: string, now: number): string {
  const payload: MagicPayload = { email: email.trim().toLowerCase(), exp: now + ttlMs(), jti: randomBytes(16).toString("hex") };
  return seal(JSON.stringify(payload));
}

export interface MagicVerdict { email: string; jti: string }

/** Open + validate a magic token (tamper + expiry). Returns the email + jti, or null. Does NOT
 *  consume single-use — call consumeMagicToken after, so verification stays pure/testable. */
export function verifyMagicToken(token: string, now: number): MagicVerdict | null {
  const raw = open(token);
  if (!raw) return null;
  let payload: MagicPayload;
  try {
    payload = JSON.parse(raw) as MagicPayload;
  } catch {
    return null;
  }
  if (typeof payload.email !== "string" || typeof payload.exp !== "number" || typeof payload.jti !== "string") return null;
  if (payload.exp <= now) return null;
  return { email: payload.email, jti: payload.jti };
}

/** Enforce single-use: returns true the FIRST time a jti is seen, false on replay. Marks it
 *  consumed in the shared-state seam with a TTL covering the token's lifetime. */
export async function consumeMagicToken(jti: string): Promise<boolean> {
  const key = `magic:jti:${jti}`;
  if (await sharedKv.get(key)) return false; // already used
  await sharedKv.set(key, "1", { ttlMs: ttlMs() * 2 });
  return true;
}

/** Sends via SMTP when `SMTP_URL` is set (lib/email.ts); otherwise falls back to logging the
 *  link for the operator/dev to relay by hand. Returns true if a real send succeeded. */
export async function sendMagicLink(email: string, link: string): Promise<boolean> {
  const minutes = Math.round(ttlMs() / 60_000);
  const sent = await sendEmail({
    to: email,
    subject: "Your OmniProject sign-in link",
    text: `Click to sign in (expires in ${minutes} minutes): ${link}\n\nIf you didn't request this, you can ignore this email.`,
  });
  if (sent) {
    logger.info({ email }, "magic-link: sent via SMTP");
  } else {
    logger.info({ email }, "magic-link: issued (no relay configured — link logged for the operator/dev only)");
    logger.debug({ email, link }, "magic-link: link");
  }
  return sent;
}
