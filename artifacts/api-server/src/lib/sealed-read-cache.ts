import fs from "node:fs";
import { isTruthy } from "./env-config";

/**
 * MTIME-KEYED DECRYPTED-READ CACHE for the sealed artifact/def stores (SCALING.md §4).
 *
 * Scope resolution (`resolveScopedConfig`, mappings, screens, vocabulary) reads the per-(type, scope)
 * AES-256-GCM sealed collections through ONE choke point (`artifact-store.readCollection`), which does an
 * fs-read + AES-decrypt per call. At many users' worth of defs a single board render re-decrypts the store
 * repeatedly. This memoises the DECRYPTED STRING of a sealed file, keyed by its path + mtime + size, so a
 * repeat read skips the fs-read and the crypto — the parse still runs per call, yielding fresh objects, so
 * there is NO shared-mutable-state risk (strings are immutable; the caller never receives a cached array).
 *
 * SELF-INVALIDATING: because the key includes the file's mtime + size, ANY write — ours (the atomic
 * temp→rename bumps mtime) or another replica's on a shared volume — is a cache miss on the next read. So it
 * can never serve a stale def. A stat failure (absent/unreadable) falls straight through to the live read
 * (fail-open to correctness — never a stale or empty answer). OFF by default (`SEALED_READ_CACHE` unset), so
 * default behaviour is byte-identical; a hot instance opts in.
 */

interface Entry {
  mtimeMs: number;
  size: number;
  /** The decrypted file contents (immutable string) — never a parsed object graph, so it's copy-free-safe. */
  raw: string;
}

/** Hard cap on live entries so memory tracks the working set of sealed files, not every path ever seen.
 *  Mirrors the bound on lib/read-cache.ts. The store is one file per (type, scope), so this is generous. */
const MAX_ENTRIES = 4_000;

const store = new Map<string, Entry>();

/** True only when an operator has opted in (`SEALED_READ_CACHE=true`). */
export function sealedReadCacheEnabled(): boolean {
  return isTruthy(process.env["SEALED_READ_CACHE"]);
}

/**
 * Return the decrypted contents of sealed file `file`, serving a cached copy when the file is unchanged
 * (same mtime + size) since it was last read. `read` is the live sealed read (fs-read + decrypt) — called on
 * a miss, a stat failure, or when the cache is disabled. A `null` from `read` (absent / undecryptable) is
 * passed straight through and never cached.
 */
export function cachedDecryptedRead(file: string, read: () => string | null): string | null {
  if (!sealedReadCacheEnabled()) return read();
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return read(); // absent/unreadable → live read, uncached (mtime can't be trusted)
  }
  const hit = store.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    // LRU touch: re-insert so this key is evicted last (Map keeps insertion order).
    store.delete(file);
    store.set(file, hit);
    return hit.raw;
  }
  const raw = read();
  if (raw === null) {
    store.delete(file); // don't cache absence; drop any stale entry for this path
    return null;
  }
  store.set(file, { mtimeMs: st.mtimeMs, size: st.size, raw });
  if (store.size > MAX_ENTRIES) evictOldest();
  return raw;
}

/** Evict the least-recently-used entry (insertion-order front) until back under the cap. */
function evictOldest(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Test-only: drop the whole cache so a subsequent read re-decrypts. */
export function _resetSealedReadCache(): void {
  store.clear();
}
