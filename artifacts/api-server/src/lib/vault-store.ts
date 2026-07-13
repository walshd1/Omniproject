import crypto from "node:crypto";
import { awsSecretsStore } from "./vault-aws";
import { azureKeyVaultStore } from "./vault-azure";
import { kmsVaultKey } from "./kms";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { decodeKey32, deriveKey, masterSecret } from "./crypto-keys";
import { safeFetch } from "./egress";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";

/**
 * Vault STORAGE seam. Where AI provider keys actually live is pluggable — the same
 * registry-of-adapters idiom as the broker/notification planes. Pick with VAULT_BACKEND:
 *
 *   - "local"     (default): an encrypted file OmniProject owns. Each secret is separately
 *                 encrypted under its own derived subkey, and the whole file is sealed again
 *                 (two layers). Self-contained; no external dependency.
 *   - "hashicorp" : HashiCorp Vault / HCP Vault (KV v2 over HTTP). VAULT_ADDR + VAULT_TOKEN.
 *   - "aws"       : AWS Secrets Manager, native (SigV4-signed). lib/vault-aws.
 *   - "azure"     : Azure Key Vault, native (AAD client-credentials). lib/vault-azure.
 *   - "http"      : a generic REST secrets store (BYO / external-secrets sidecar).
 *                 VAULT_HTTP_URL + token — for any manager without a native adapter.
 *
 * For EXTERNAL stores the manager IS the encryption boundary, so OmniProject keeps the
 * secret in plaintext over the wire to that store (TLS) — it does not double-encrypt. Only
 * the "local" store applies OmniProject's own at-rest crypto.
 *
 * Contract: a store loads all secrets it holds (ref → plaintext) and persists/removes one at
 * a time. Reads in lib/vault are served from an in-memory cache hydrated from load().
 */
/** Coerce an external secrets-backend response into a clean `ref → value` string map, dropping any
 *  non-string entry. Zero-trust defence-in-depth: even the operator's own (TLS, authenticated) backend
 *  response is shape-validated before its values become live AI keys, rather than cast-and-trusted. */
export function coerceSecretMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k !== "__proto__" && typeof v === "string") out[k] = v;
  }
  return out;
}

export interface VaultStore {
  id: string;
  /** Optional synchronous load (local file only) — lets non-booted contexts read at once. */
  loadSync?(): Record<string, string>;
  /** Load every secret this store holds. */
  load(): Promise<Record<string, string>>;
  /** Persist one secret. */
  put(ref: string, value: string): Promise<void>;
  /** Remove one secret. */
  del(ref: string): Promise<void>;
}

// ── local: an OmniProject-owned, doubly-encrypted file ──────────────────────────
const ENV_PREFIX = "k1.";    // LEGACY per-secret envelope (read-only): sha256-derived root
const ENV_PREFIX_V2 = "k2."; // current per-secret envelope: HKDF (shared deriveKey) root

/** A raw override key — a KMS-unwrapped BYOK envelope (wins; the plaintext key never sat in env),
 *  else base64 `VAULT_KEY`. Already strong 32-byte material, so it's used directly for BOTH envelope
 *  versions (the legacy vs HKDF distinction only matters for the master-derived fallback). */
function overrideKey(): Buffer | null {
  const kms = kmsVaultKey();
  if (kms) return kms;
  const raw = process.env["VAULT_KEY"]?.trim();
  return raw ? decodeKey32(raw) : null;
}

function vaultMaster(): string {
  return masterSecret({ dev: "omni-vault-dev-master-not-for-production" });
}

/** LEGACY root (opens existing `k1.` secrets): the raw override, else the pre-HKDF sha256 derivation. */
function rootKeyLegacy(): Buffer {
  return overrideKey() ?? crypto.createHash("sha256").update(`vault:v1:${vaultMaster()}`).digest();
}

/** CURRENT root (HKDF): the raw override (unchanged — already a strong key), else the shared
 *  deriveKey. New `k2.` secrets seal under this; existing `k1.` secrets migrate to `k2.` on next put. */
function rootKeyHkdf(): Buffer {
  return overrideKey() ?? deriveKey(vaultMaster(), "vault:v2");
}

function subKey(ref: string, root: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", root, Buffer.from(ref, "utf8"), Buffer.from("omni-vault-secret"), 32));
}

function sealSecret(ref: string, value: string): string {
  return ENV_PREFIX_V2 + aesGcmSeal(value, subKey(ref, rootKeyHkdf()));
}

function openSecret(ref: string, env: string): string | null {
  const v2 = env.startsWith(ENV_PREFIX_V2);
  if (!v2 && !env.startsWith(ENV_PREFIX)) return null;
  const root = v2 ? rootKeyHkdf() : rootKeyLegacy();
  const opened = aesGcmOpen(env.slice((v2 ? ENV_PREFIX_V2 : ENV_PREFIX).length), subKey(ref, root));
  if (opened === null) logger.warn({ ref }, "vault(local): an envelope entry exists but failed to decrypt — check VAULT_KEY/KMS config hasn't changed");
  return opened;
}

const store = new SealedFile(() => resolveConfigFile("VAULT_FILE", "vault.json"), "vault(local)");

function readEnvelopes(): Record<string, string> {
  const raw = store.read();
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as { secrets?: Record<string, string> };
    return parsed.secrets && typeof parsed.secrets === "object" ? parsed.secrets : {};
  } catch (err) {
    logger.warn({ err }, "vault(local): failed to read file — treating as empty");
    return {};
  }
}

function writeEnvelopes(envelopes: Record<string, string>): void {
  store.write(JSON.stringify({ secrets: envelopes }));
}

const localStore: VaultStore = {
  id: "local",
  loadSync() {
    const out: Record<string, string> = {};
    for (const [ref, env] of Object.entries(readEnvelopes())) {
      const v = openSecret(ref, env);
      if (v !== null) out[ref] = v;
    }
    return out;
  },
  load() { return Promise.resolve(this.loadSync!()); },
  put(ref, value) {
    const env = readEnvelopes();
    env[ref] = sealSecret(ref, value);
    writeEnvelopes(env);
    return Promise.resolve();
  },
  del(ref) {
    const env = readEnvelopes();
    if (ref in env) { delete env[ref]; writeEnvelopes(env); }
    return Promise.resolve();
  },
};

// ── hashicorp: Vault / HCP Vault, KV v2 (one path holds the ref→value map) ───────
function hashicorpStore(): VaultStore {
  const addr = process.env["VAULT_ADDR"]?.trim() || "http://127.0.0.1:8200";
  const token = process.env["VAULT_TOKEN"]?.trim() || "";
  const mount = process.env["VAULT_KV_MOUNT"]?.trim() || "secret";
  const secretPath = process.env["VAULT_KV_PATH"]?.trim() || "omni-ai-vault";
  const url = `${addr.replace(/\/$/, "")}/v1/${mount}/data/${secretPath}`;
  const headers = { "X-Vault-Token": token, "Content-Type": "application/json" };

  const read = async (): Promise<Record<string, string>> => {
    const res = await safeFetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`Vault read ${res.status}`);
    const json = (await res.json()) as { data?: { data?: unknown } };
    return coerceSecretMap(json.data?.data);
  };
  const write = async (map: Record<string, string>): Promise<void> => {
    const res = await safeFetch(url, { method: "POST", headers, body: JSON.stringify({ data: map }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Vault write ${res.status}`);
  };
  return {
    id: "hashicorp",
    load: read,
    async put(ref, value) { const m = await read(); m[ref] = value; await write(m); },
    async del(ref) { const m = await read(); if (ref in m) { delete m[ref]; await write(m); } },
  };
}

// ── http: a generic REST secrets store (BYO / sidecar; also fronts AWS/Azure) ────
function httpStore(): VaultStore {
  const base = (process.env["VAULT_HTTP_URL"]?.trim() || "").replace(/\/$/, "");
  const token = process.env["VAULT_HTTP_TOKEN"]?.trim();
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const headers = { "Content-Type": "application/json", ...auth };
  const refUrl = (ref: string) => `${base}/secrets/${encodeURIComponent(ref)}`;
  return {
    id: "http",
    async load() {
      const res = await safeFetch(`${base}/secrets`, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return {};
      if (!res.ok) throw new Error(`Secrets store read ${res.status}`);
      return coerceSecretMap(await res.json());
    },
    async put(ref, value) {
      const res = await safeFetch(refUrl(ref), { method: "PUT", headers, body: JSON.stringify({ value }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Secrets store write ${res.status}`);
    },
    async del(ref) {
      const res = await safeFetch(refUrl(ref), { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok && res.status !== 404) throw new Error(`Secrets store delete ${res.status}`);
    },
  };
}

/** The registry of storage backends. Adding a manager is one entry here, not a new branch
 *  elsewhere. AWS Secrets Manager and Azure Key Vault are NATIVE (SigV4 / AAD); the generic
 *  `http` contract remains for any other store or an external-secrets sidecar. */
const BACKENDS: Record<string, () => VaultStore> = {
  local: () => localStore,
  hashicorp: hashicorpStore,
  hcp: hashicorpStore, // HCP Vault is HashiCorp Vault with VAULT_ADDR pointed at the cloud
  http: httpStore,
  aws: awsSecretsStore,
  azure: azureKeyVaultStore,
};

/** The configured backend id (VAULT_BACKEND), defaulting to the local encrypted file. */
export function vaultBackendId(): string {
  const id = process.env["VAULT_BACKEND"]?.trim().toLowerCase() || "local";
  return id in BACKENDS ? id : "local";
}

/** Resolve the active storage backend from the registry. */
export function activeVaultStore(): VaultStore {
  return BACKENDS[vaultBackendId()]!();
}

/** The backend ids OmniProject can use (for status/diagnostics). */
export const VAULT_BACKENDS: readonly string[] = Object.keys(BACKENDS);
