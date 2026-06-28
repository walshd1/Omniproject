import crypto from "node:crypto";

/**
 * Config-at-rest encryption.
 *
 * The customer-wide config files OmniProject persists (the config store, exported
 * snapshots) are sealed with AES-256-GCM so that a copy of the raw files on disk — or
 * moved between machines — is opaque without the key. Authenticated (GCM): a tampered
 * file fails the tag and is rejected rather than silently mis-parsed.
 *
 * Key: CONFIG_KEY ?? a value derived from the existing env master, so encryption is on by
 * default without new secret distribution. The key never changes the wire/session crypto
 * — a separate prefix + derivation keep the domains independent.
 *
 * HONEST SCOPE: this protects data AT REST (someone reading the files). It does NOT
 * protect against an attacker who already holds the key/env master or the running process.
 * The admin key-export below lets an operator carry the key to another deployment to
 * decrypt moved files — a real secret leaving the boundary, so it's hard-gated + audited.
 */
const PREFIX = "c1.";

function master(): string {
  return (
    process.env["CONFIG_KEY"]?.trim() ||
    process.env["SESSION_SECRET"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    "omni-config-crypto-dev-master-not-for-production"
  );
}

/** The 32-byte config key. A raw exported key (CONFIG_KEY_RAW, base64 32 bytes) is used
 *  DIRECTLY — that's what an admin sets on a target deployment to decrypt moved files —
 *  otherwise the key is derived from the master (domain-separated). */
function key(): Buffer {
  const raw = process.env["CONFIG_KEY_RAW"]?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  return crypto.createHash("sha256").update(`config:${master()}`).digest();
}

/** Seal a config string → a versioned base64url token. */
export function sealConfig(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Open a sealed token, or null if it isn't one / fails authentication. */
export function openConfig(token: string): string | null {
  if (!token.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(token.slice(PREFIX.length), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Read possibly-sealed config text: open if sealed, else return as-is (plaintext migration). */
export function readMaybeSealed(text: string): string {
  return text.startsWith(PREFIX) ? (openConfig(text) ?? "") : text;
}

/** The exportable config key (base64). Lets an admin decrypt moved files on another box.
 *  SENSITIVE — only ever returned via the admin + step-up gated route, audited. */
export function exportConfigKey(): string {
  return key().toString("base64");
}

/** A short, non-secret fingerprint of the key, so two deployments can confirm a match
 *  without revealing the key. */
export function configKeyFingerprint(): string {
  return crypto.createHash("sha256").update(key()).digest("hex").slice(0, 12);
}
