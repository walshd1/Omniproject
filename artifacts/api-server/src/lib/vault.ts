import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sealConfig, readMaybeSealed } from "./config-crypto";
import { logger } from "./logger";

/**
 * AI secret vault — where provider API keys live now that they are OUT of docker/env.
 *
 * Two independent layers ("super encrypted"):
 *   1. Each secret is SEPARATELY encrypted under its OWN derived subkey
 *      (HKDF-SHA256(root, salt=ref)) → envelope "k1.<b64url(iv|tag|ct)>". Distinct key
 *      material per secret, so cracking one envelope tells you nothing about the next.
 *   2. The whole vault file is ITSELF sealed at rest with the config-store crypto — a
 *      second, independent encryption over the already-encrypted envelopes.
 *
 * Secrets are WRITE-ONLY across the API boundary: getSecret() is INTERNAL (used only to
 * sign the upstream provider call); no route ever returns a plaintext secret — only
 * presence + a short fingerprint for "did my paste land?" verification.
 *
 * Root key: VAULT_KEY (base64 32 bytes) if set, else derived from the env master and
 * domain-separated from the config key. ONE root protects many secrets; the secrets
 * themselves never sit in the environment.
 *
 * Storage: a single company-wide file — VAULT_FILE, or <OMNI_CONFIG_DIR>/vault.json. With
 * neither set the vault is RAM-only (stateless deployments; secrets re-entered per boot).
 *
 * HONEST SCOPE: protects keys AT REST; not against someone holding the root/process.
 */
const ENV_PREFIX = "k1."; // per-secret envelope

function rootKey(): Buffer {
  const raw = process.env["VAULT_KEY"]?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const master =
    process.env["SESSION_SECRET"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    "omni-vault-dev-master-not-for-production";
  // Domain-separated from config:* so the vault is independent of the config-at-rest key.
  return crypto.createHash("sha256").update(`vault:v1:${master}`).digest();
}

/** Per-secret subkey — distinct material for each ref, so envelopes don't share a key. */
function subKey(ref: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootKey(), Buffer.from(ref, "utf8"), Buffer.from("omni-vault-secret"), 32));
}

function seal(ref: string, value: string): string {
  const key = subKey(ref);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ENV_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

function open(ref: string, env: string): string | null {
  if (!env.startsWith(ENV_PREFIX)) return null;
  try {
    const raw = Buffer.from(env.slice(ENV_PREFIX.length), "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", subKey(ref), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// In-memory map of ref → per-secret envelope (already individually encrypted).
let store: Record<string, string> = {};
let loaded = false;

function vaultFile(): string | null {
  const explicit = process.env["VAULT_FILE"]?.trim();
  if (explicit) return explicit;
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  return dir ? path.join(dir, "vault.json") : null;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const file = vaultFile();
  if (!file || !fs.existsSync(file)) return;
  try {
    const parsed = JSON.parse(readMaybeSealed(fs.readFileSync(file, "utf8"))) as { secrets?: Record<string, string> };
    store = parsed.secrets && typeof parsed.secrets === "object" ? parsed.secrets : {};
    logger.info({ count: Object.keys(store).length }, "vault: restored secrets from disk");
  } catch (err) {
    logger.warn({ err }, "vault: failed to restore — starting empty");
  }
}

function persist(): void {
  const file = vaultFile();
  if (!file) return; // RAM-only deployment
  try {
    // Second layer: seal the whole file (already-encrypted envelopes) with the config crypto.
    fs.writeFileSync(file, sealConfig(JSON.stringify({ secrets: store })));
  } catch (err) {
    logger.warn({ err }, "vault: failed to persist");
  }
}

/** Store (or replace) a secret. The plaintext is encrypted immediately and never kept. */
export function setSecret(ref: string, value: string): void {
  ensureLoaded();
  store[ref] = seal(ref, value);
  persist();
}

/** INTERNAL: the plaintext secret, or null. Never expose this over a route. */
export function getSecret(ref: string): string | null {
  ensureLoaded();
  const env = store[ref];
  return env ? open(ref, env) : null;
}

/** Is a secret present for this ref? (Safe to expose — boolean only.) */
export function hasSecret(ref: string): boolean {
  ensureLoaded();
  return ref in store;
}

/** Remove a secret. */
export function deleteSecret(ref: string): void {
  ensureLoaded();
  if (ref in store) { delete store[ref]; persist(); }
}

/** A short, non-reversible fingerprint of the stored secret (for "did it save?" UX), or null. */
export function secretFingerprint(ref: string): string | null {
  const value = getSecret(ref);
  if (value === null) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** The refs that currently have a secret (no values). */
export function listSecretRefs(): string[] {
  ensureLoaded();
  return Object.keys(store).sort();
}

/** Test-only: wipe the in-memory vault and force a reload on next access. */
export function __resetVault(): void {
  store = {};
  loaded = false;
}
