import { randomBytes } from "node:crypto";
import { seal, open } from "./session-crypto";
import { sharedKv } from "./shared-state";
import { isTruthy } from "./env-config";
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
  return isTruthy(process.env["MAGIC_LINK_ENABLED"]) && !isOidcConfigured && !isSamlConfigured();
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
 *  consumed in the shared-state seam with a TTL covering the token's lifetime.
 *
 *  Atomic claim: a compare-and-set (set only if absent) collapses the check + mark into ONE
 *  race-free step, so two concurrent redemptions of the same link can't both win. A get-then-set
 *  had an await boundary between the read and the write — under Redis a full round-trip — during
 *  which both callers observed "unused" and both minted a session. `cas` is the same shared-seam
 *  primitive lib/audit-chain uses for its fleet-wide head; it is fleet-wide when Redis is
 *  configured and per-process otherwise (the single-replica default is inherently race-free here). */
export async function consumeMagicToken(jti: string): Promise<boolean> {
  const key = `magic:jti:${jti}`;
  return sharedKv.cas(key, null, "1", { ttlMs: ttlMs() * 2 });
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
    // No SMTP relay: the operator must hand off the link. The link CONTAINS the single-use auth
    // token, so logging it verbatim is an account-takeover primitive for anyone who can read logs.
    // Default to NOT logging it; a no-SMTP operator who genuinely relies on log-relay opts in with
    // MAGIC_LINK_LOG_URL=1 (documented as sensitive). `link` is never added to the logger redact
    // list precisely because this opt-in path needs it verbatim.
    if (isTruthy(process.env["MAGIC_LINK_LOG_URL"])) {
      logger.warn({ email, link }, "magic-link: link (MAGIC_LINK_LOG_URL — token-bearing, sensitive)");
    } else {
      logger.info({ email }, "magic-link: issued (no relay configured; set MAGIC_LINK_LOG_URL=1 to log the link)");
    }
  }
  return sent;
}
