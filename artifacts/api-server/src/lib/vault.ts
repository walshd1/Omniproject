import crypto from "node:crypto";
import { activeVaultStore, vaultBackendId } from "./vault-store";
import { logger } from "./logger";

/**
 * AI secret vault — where provider API keys live now that they are OUT of docker/env.
 *
 * Storage is PLUGGABLE (lib/vault-store): the default is an OmniProject-owned, doubly-
 * encrypted local file; alternatively the keys can live in HashiCorp Vault / HCP, AWS
 * Secrets Manager, Azure Key Vault, or another store, selected by VAULT_BACKEND.
 *
 * This module is the in-process surface over whichever store is active:
 *   - READS are synchronous, served from an in-memory cache. For the local store the cache
 *     lazy-loads from the file; for external stores it is filled by hydrateVault() at boot.
 *   - WRITES are async (they hit the backing store) and update the cache write-through.
 *   - Secrets are WRITE-ONLY across the API boundary: getSecret() is INTERNAL (used only to
 *     sign the upstream provider call); no route ever returns a plaintext secret — only
 *     presence + a short fingerprint.
 *
 * HONEST SCOPE: protects keys at rest (local: our crypto; external: the manager's), not
 * against someone holding the root/process. A write to an external store is awaited so a
 * failure surfaces; the cache stays authoritative for the running process either way.
 */
let cache: Record<string, string> = {};
let hydrated = false;

/** Ensure the cache is populated for SYNCHRONOUS reads. Local store can load at once; an
 *  external store needs an awaited hydrateVault() (called at boot) — until then it's empty. */
function ensureSync(): void {
  if (hydrated) return;
  const store = activeVaultStore();
  if (store.loadSync) {
    cache = store.loadSync();
    hydrated = true;
  }
}

/** Load every secret from the active store into the cache. Call once at boot (await). */
export async function hydrateVault(): Promise<void> {
  try {
    cache = await activeVaultStore().load();
    hydrated = true;
    logger.info({ backend: vaultBackendId(), count: Object.keys(cache).length }, "vault: hydrated from store");
  } catch (err) {
    logger.warn({ err, backend: vaultBackendId() }, "vault: hydrate failed — starting empty");
    hydrated = true; // don't thrash the store on every read; writes will still try to persist
  }
}

/** Store (or replace) a secret. Updates the cache and persists to the active store. */
export async function setSecret(ref: string, value: string): Promise<void> {
  ensureSync();
  cache[ref] = value;
  await activeVaultStore().put(ref, value);
}

/** INTERNAL: the plaintext secret, or null. Never expose this over a route. */
export function getSecret(ref: string): string | null {
  ensureSync();
  return ref in cache ? cache[ref]! : null;
}

/** Is a secret present for this ref? (Safe to expose — boolean only.) */
export function hasSecret(ref: string): boolean {
  ensureSync();
  return ref in cache;
}

/** Remove a secret from the cache and the active store. */
export async function deleteSecret(ref: string): Promise<void> {
  ensureSync();
  if (ref in cache) delete cache[ref];
  await activeVaultStore().del(ref);
}

/** A short, non-reversible fingerprint of the stored secret (for "did it save?" UX), or null. */
export function secretFingerprint(ref: string): string | null {
  const value = getSecret(ref);
  if (value === null) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** The refs that currently have a secret (no values). */
export function listSecretRefs(): string[] {
  ensureSync();
  return Object.keys(cache).sort();
}

/** Test-only: wipe the in-memory cache and force a reload on next access. */
export function __resetVault(): void {
  cache = {};
  hydrated = false;
}
