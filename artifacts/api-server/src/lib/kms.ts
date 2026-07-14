import { awsSignedHeaders, awsCredsFromEnv } from "./aws-sigv4";
import { safeFetch } from "./egress";
import { logger } from "./logger";

/**
 * KMS / BYOK envelope unwrap for the gateway's ROOT keys. Instead of a plaintext key sitting
 * in the environment, the deployment supplies a KMS-WRAPPED blob and a cloud KMS unwraps it at
 * boot — so the key-encryption-key never leaves the HSM/KMS. Two roots can be wrapped:
 *   - VAULT_KEY_ENC   → the AI secrets-vault root key.
 *   - CONFIG_KEY_ENC  → the config-AT-REST key (the one that seals config.json, the security
 *                       state, snapshots, the vault file's outer layer, etc.).
 *
 * Pluggable, like the vault storage itself (KMS_PROVIDER):
 *   - "none" (default): no KMS; keys come from VAULT_KEY / CONFIG_KEY_RAW / derived as before.
 *   - "aws"  : AWS KMS Decrypt (SigV4). *_ENC = base64 CiphertextBlob.
 *   - "azure": Azure Key Vault key Decrypt (RSA-OAEP-256). VAULT_KMS_KEY_URL + AAD creds.
 *   - "local": dev/test passthrough — *_ENC is just base64 of the 32-byte key (NO real
 *             wrapping). Lets the envelope path be exercised without a cloud KMS.
 *
 * Unwrap is async (network), so it runs ONCE at boot (initKms, before any sealed file is read)
 * and the results are cached for the synchronous key reads. HONEST SCOPE: protects the key at
 * rest in env/config; not against someone holding the running process or the KMS credentials.
 */
type KmsProvider = "none" | "aws" | "azure" | "local";

let vaultKeyCache: Buffer | null = null;
let configKeyCache: Buffer | null = null;
let initialised = false;

/** The configured KMS provider (KMS_PROVIDER), defaulting to none. */
export function kmsProvider(): KmsProvider {
  const p = process.env["KMS_PROVIDER"]?.trim().toLowerCase();
  return p === "aws" || p === "azure" || p === "local" ? p : "none";
}

/** Is any KMS-wrapped root key configured? */
export function kmsEnabled(): boolean {
  return kmsProvider() !== "none" && (!!process.env["VAULT_KEY_ENC"]?.trim() || !!process.env["CONFIG_KEY_ENC"]?.trim());
}

// ── aws: KMS Decrypt ────────────────────────────────────────────────────────────
async function awsUnwrap(ciphertextB64: string): Promise<Buffer> {
  const { region, creds } = awsCredsFromEnv();
  const host = `kms.${region}.amazonaws.com`;
  const body = JSON.stringify({ CiphertextBlob: ciphertextB64 });
  const headers = awsSignedHeaders({ host, region, service: "kms", target: "TrentService.Decrypt", body, creds });
  const res = await safeFetch(`https://${host}/`, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`AWS KMS Decrypt ${res.status}`);
  const json = (await res.json()) as { Plaintext?: string };
  if (!json.Plaintext) throw new Error("AWS KMS Decrypt returned no plaintext");
  return Buffer.from(json.Plaintext, "base64");
}

// ── azure: Key Vault key Decrypt (RSA-OAEP-256) ──────────────────────────────────
async function azureUnwrap(ciphertextB64: string): Promise<Buffer> {
  const keyUrl = (process.env["VAULT_KMS_KEY_URL"]?.trim() || "").replace(/\/$/, ""); // .../keys/<name>/<ver>
  const tenant = process.env["AZURE_TENANT_ID"]?.trim() || "";
  const clientId = process.env["AZURE_CLIENT_ID"]?.trim() || "";
  const clientSecret = process.env["AZURE_CLIENT_SECRET"]?.trim() || "";
  const tokenRes = await safeFetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "https://vault.azure.net/.default" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`Azure AAD token ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token ?? "";
  // Key Vault uses base64url for the ciphertext value.
  const value = Buffer.from(ciphertextB64, "base64").toString("base64url");
  const res = await safeFetch(`${keyUrl}/decrypt?api-version=7.4`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ alg: "RSA-OAEP-256", value }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Azure Key Vault decrypt ${res.status}`);
  const json = (await res.json()) as { value?: string };
  if (!json.value) throw new Error("Azure Key Vault decrypt returned no value");
  return Buffer.from(json.value, "base64url");
}

/** Unwrap a wrapped key blob with the configured KMS. Exposed for testing/diagnostics. */
export async function unwrapDataKey(ciphertextB64: string): Promise<Buffer> {
  switch (kmsProvider()) {
    case "aws": return awsUnwrap(ciphertextB64);
    case "azure": return azureUnwrap(ciphertextB64);
    case "local": return Buffer.from(ciphertextB64, "base64"); // dev passthrough
    default: throw new Error("KMS_PROVIDER is not set");
  }
}

async function unwrapInto(envName: string, label: string): Promise<Buffer | null> {
  const blob = process.env[envName]?.trim();
  if (!blob) return null;
  const key = await unwrapDataKey(blob);
  if (key.length !== 32) throw new Error(`unwrapped ${label} key must be 32 bytes, got ${key.length}`);
  return key;
}

/** Unwrap one root key and, on success, hand it to `assign` (the cache var setter) + log.
 *  A failure is logged loudly (not fatal) so the gateway falls back to env/derived keys —
 *  never lets one root key's failure block the other's. */
async function resolveKey(envName: string, label: string, assign: (key: Buffer) => void): Promise<void> {
  try {
    const key = await unwrapInto(envName, label);
    if (key) { assign(key); logger.info({ provider: kmsProvider() }, `kms: ${label} key unwrapped`); }
  } catch (err) {
    logger.warn({ err, provider: kmsProvider() }, `kms: failed to unwrap ${label} key — falling back`);
  }
}

/**
 * Resolve KMS-wrapped root keys at boot, BEFORE any sealed file is read. Idempotent; failures
 * are logged loudly (not fatal) so the gateway falls back to env/derived keys. The CONFIG key
 * is unwrapped first so the config store opens correctly, then the vault key.
 */
export async function initKms(): Promise<void> {
  if (initialised) return;
  initialised = true;
  if (!kmsEnabled()) return;
  await resolveKey("CONFIG_KEY_ENC", "config", (key) => { configKeyCache = key; });
  await resolveKey("VAULT_KEY_ENC", "vault", (key) => { vaultKeyCache = key; });
}

/** The KMS-unwrapped vault root key, or null when KMS isn't used / hasn't resolved yet. */
export function kmsVaultKey(): Buffer | null {
  return vaultKeyCache;
}

/** The KMS-unwrapped config-at-rest key, or null. */
export function kmsConfigKey(): Buffer | null {
  return configKeyCache;
}

/** Test-only: reset the caches + init flag. */
export function __resetKms(): void {
  vaultKeyCache = null;
  configKeyCache = null;
  initialised = false;
}

/**
 * ACTIVE zeroisation of the KMS-unwrapped ROOT keys — the most sensitive bytes in the process.
 * Overwrites each key Buffer with zeros before dropping it, so the config-at-rest / vault root key
 * can't be lifted from a memory image captured after a graceful shutdown. Called by the shutdown
 * cleanse (lib/wipe). Leaves `initialised` set so a post-cleanse code path can't silently re-unwrap.
 */
export function zeroizeKmsKeys(): void {
  vaultKeyCache?.fill(0);
  configKeyCache?.fill(0);
  vaultKeyCache = null;
  configKeyCache = null;
}
