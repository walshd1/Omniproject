import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sealConfig, readMaybeSealed } from "./config-crypto";
import { awsSecretsStore } from "./vault-aws";
import { azureKeyVaultStore } from "./vault-azure";
import { kmsVaultKey } from "./kms";
import { logger } from "./logger";

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
const ENV_PREFIX = "k1."; // per-secret envelope

function rootKey(): Buffer {
  // A KMS-unwrapped key (BYOK envelope) wins — the plaintext key never sat in env.
  const kms = kmsVaultKey();
  if (kms) return kms;
  const raw = process.env["VAULT_KEY"]?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const master =
    process.env["SESSION_SECRET"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    "omni-vault-dev-master-not-for-production";
  return crypto.createHash("sha256").update(`vault:v1:${master}`).digest();
}

function subKey(ref: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootKey(), Buffer.from(ref, "utf8"), Buffer.from("omni-vault-secret"), 32));
}

function sealSecret(ref: string, value: string): string {
  const key = subKey(ref);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ENV_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

function openSecret(ref: string, env: string): string | null {
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

function localFile(): string | null {
  const explicit = process.env["VAULT_FILE"]?.trim();
  if (explicit) return explicit;
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  return dir ? path.join(dir, "vault.json") : null;
}

function readEnvelopes(): Record<string, string> {
  const file = localFile();
  if (!file || !fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readMaybeSealed(fs.readFileSync(file, "utf8"))) as { secrets?: Record<string, string> };
    return parsed.secrets && typeof parsed.secrets === "object" ? parsed.secrets : {};
  } catch (err) {
    logger.warn({ err }, "vault(local): failed to read file — treating as empty");
    return {};
  }
}

function writeEnvelopes(envelopes: Record<string, string>): void {
  const file = localFile();
  if (!file) return; // RAM-only deployment
  fs.writeFileSync(file, sealConfig(JSON.stringify({ secrets: envelopes })));
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
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`Vault read ${res.status}`);
    const json = (await res.json()) as { data?: { data?: Record<string, string> } };
    return json.data?.data ?? {};
  };
  const write = async (map: Record<string, string>): Promise<void> => {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ data: map }), signal: AbortSignal.timeout(15_000) });
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
      const res = await fetch(`${base}/secrets`, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return {};
      if (!res.ok) throw new Error(`Secrets store read ${res.status}`);
      return (await res.json()) as Record<string, string>;
    },
    async put(ref, value) {
      const res = await fetch(refUrl(ref), { method: "PUT", headers, body: JSON.stringify({ value }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Secrets store write ${res.status}`);
    },
    async del(ref) {
      const res = await fetch(refUrl(ref), { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) });
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
