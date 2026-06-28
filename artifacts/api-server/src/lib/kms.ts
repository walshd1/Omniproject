import { awsSignedHeaders, awsCredsFromEnv } from "./aws-sigv4";
import { logger } from "./logger";

/**
 * KMS / BYOK envelope unwrap for the vault ROOT key. Instead of the plaintext vault key
 * sitting in the environment, the deployment supplies a KMS-WRAPPED blob (VAULT_KEY_ENC) and
 * a cloud KMS unwraps it at boot — so the key-encryption-key never leaves the HSM/KMS.
 *
 * Pluggable, like the vault storage itself (KMS_PROVIDER):
 *   - "none" (default): no KMS; the vault uses VAULT_KEY / a derived key as before.
 *   - "aws"  : AWS KMS Decrypt (SigV4). VAULT_KEY_ENC = base64 CiphertextBlob.
 *   - "azure": Azure Key Vault key Decrypt (RSA-OAEP-256). VAULT_KMS_KEY_URL + AAD creds.
 *   - "local": dev/test passthrough — VAULT_KEY_ENC is just base64 of the 32-byte key (NO
 *             real wrapping). Lets the envelope path be exercised without a cloud KMS.
 *
 * Unwrap is async (network), so it runs once at boot (initKms) and the result is cached for
 * the synchronous vault root-key read. HONEST SCOPE: protects the key at rest in env/config;
 * not against someone holding the running process or the KMS credentials.
 */
type KmsProvider = "none" | "aws" | "azure" | "local";

let vaultKeyCache: Buffer | null = null;
let initialised = false;

/** The configured KMS provider (KMS_PROVIDER), defaulting to none. */
export function kmsProvider(): KmsProvider {
  const p = process.env["KMS_PROVIDER"]?.trim().toLowerCase();
  return p === "aws" || p === "azure" || p === "local" ? p : "none";
}

/** Is a KMS-wrapped vault key configured? */
export function kmsEnabled(): boolean {
  return kmsProvider() !== "none" && !!process.env["VAULT_KEY_ENC"]?.trim();
}

// ── aws: KMS Decrypt ────────────────────────────────────────────────────────────
async function awsUnwrap(ciphertextB64: string): Promise<Buffer> {
  const { region, creds } = awsCredsFromEnv();
  const host = `kms.${region}.amazonaws.com`;
  const body = JSON.stringify({ CiphertextBlob: ciphertextB64 });
  const headers = awsSignedHeaders({ host, region, service: "kms", target: "TrentService.Decrypt", body, creds });
  const res = await fetch(`https://${host}/`, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
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
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "https://vault.azure.net/.default" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`Azure AAD token ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token ?? "";
  // Key Vault uses base64url for the ciphertext value.
  const value = Buffer.from(ciphertextB64, "base64").toString("base64url");
  const res = await fetch(`${keyUrl}/decrypt?api-version=7.4`, {
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

/** Resolve KMS-wrapped keys at boot (currently the vault root). Safe to call once; idempotent. */
export async function initKms(): Promise<void> {
  if (initialised) return;
  initialised = true;
  if (!kmsEnabled()) return;
  try {
    const key = await unwrapDataKey(process.env["VAULT_KEY_ENC"]!.trim());
    if (key.length !== 32) throw new Error(`unwrapped vault key must be 32 bytes, got ${key.length}`);
    vaultKeyCache = key;
    logger.info({ provider: kmsProvider() }, "kms: vault root key unwrapped");
  } catch (err) {
    // Fail LOUD but don't crash: the vault falls back to VAULT_KEY/derived. An operator who
    // set KMS expects it to work, so this is a warning they must see.
    logger.warn({ err, provider: kmsProvider() }, "kms: failed to unwrap vault key — falling back");
  }
}

/** The KMS-unwrapped vault root key, or null when KMS isn't used / hasn't resolved yet. */
export function kmsVaultKey(): Buffer | null {
  return vaultKeyCache;
}

/** Test-only: reset the cache + init flag. */
export function __resetKms(): void {
  vaultKeyCache = null;
  initialised = false;
}
