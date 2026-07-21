/**
 * ENCRYPTED, EPHEMERAL offline cache (roadmap 2.5 slice 2) — the zero-at-rest-honouring on-device store for
 * the my-work / tasks read models, so the app opens with "my work" while offline. Opt-in per user, off by
 * default (gated by the `offlineCache` feature module + a local toggle).
 *
 * Security posture (the golden-rule decision):
 *   - **Encrypted at rest.** Every entry is AES-256-GCM ciphertext (random 96-bit IV per write). The key is
 *     a NON-EXTRACTABLE WebCrypto `CryptoKey` — its raw bytes can never be read by script, only used to
 *     en/decrypt — stored in IndexedDB (structured-clone of a non-extractable key is browser-protected).
 *   - **Session-scoped.** The key is bound to the signed-in `sub`; opening the store as a DIFFERENT user
 *     wipes it and mints a fresh key, so one person's cache is never readable by the next on a shared device.
 *   - **Ephemeral.** Entries carry a timestamp and expire after {@link OFFLINE_TTL_MS}; the whole store is
 *     wiped on logout (see lib/auth) and when the user turns the toggle off.
 *   - **Narrow scope.** Only query keys on the allow-list ({@link isCacheableKey}) are ever written — the
 *     my-work issues + tasks read models, nothing else.
 *
 * This module owns the crypto + IndexedDB I/O + the allow-list; the React wiring lives in
 * lib/use-offline-cache. Everything degrades to a safe no-op where `indexedDB`/`crypto.subtle` is absent
 * (SSR, tests, private-mode blocks).
 */

const DB_NAME = "omni-offline";
const DB_VERSION = 1;
const META_STORE = "meta";
const ENTRY_STORE = "entries";
const META_KEY = "self";

/** How long an offline entry stays usable before it's treated as stale (24h). */
export const OFFLINE_TTL_MS = 24 * 60 * 60 * 1000;

/** The query-key prefixes we are permitted to cache — the my-work issues + tasks read models ONLY. */
export const CACHEABLE_KEY_PREFIXES = ["tasks", "my-work-issues"] as const;

/** Whether a react-query key is one we may persist offline (its head is on the allow-list). */
export function isCacheableKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && (CACHEABLE_KEY_PREFIXES as readonly string[]).includes(key[0]);
}

/** Whether an entry stamped at `at` is still fresh at `now`. Pure. */
export function isFresh(at: number, now: number, ttl = OFFLINE_TTL_MS): boolean {
  return now - at < ttl && now - at >= 0;
}

/** A stable string id for a query key (its JSON form) — the IndexedDB primary key for an entry. */
export const entryId = (key: readonly unknown[]): string => JSON.stringify(key);

interface StoredEntry { id: string; key: unknown[]; iv: number[]; ct: ArrayBuffer; at: number }
interface StoredMeta { id: string; sub: string; key: CryptoKey }

const subtle = (): SubtleCrypto | null =>
  (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
const idb = (): IDBFactory | null => (typeof indexedDB !== "undefined" ? indexedDB : null);

// ── Crypto (pure over WebCrypto) ────────────────────────────────────────────────────────────────────────

/** Mint a fresh non-extractable AES-256-GCM key (raw bytes never leave the browser). */
export async function generateCacheKey(): Promise<CryptoKey> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto unavailable");
  return s.generateKey({ name: "AES-GCM", length: 256 }, false /* non-extractable */, ["encrypt", "decrypt"]);
}

/** Encrypt a JSON-serialisable value → { iv, ct }. */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: Uint8Array; ct: ArrayBuffer }> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto unavailable");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = await s.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { iv, ct };
}

/** Decrypt { iv, ct } back to its value, or null if it can't be decrypted (wrong key / tampered). */
export async function decryptJson<T = unknown>(key: CryptoKey, iv: Uint8Array, ct: ArrayBuffer): Promise<T | null> {
  const s = subtle();
  if (!s) return null;
  try {
    const pt = await s.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null; // wrong key or tampered ciphertext
  }
}

// ── IndexedDB adapter (guarded; no-op when unavailable) ─────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  const factory = idb();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = factory.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/**
 * Get the current user's cache key, minting one on first use. If the store belongs to a DIFFERENT user, it's
 * wiped first (a fresh key + empty entries) so cross-user reads are impossible. Returns null when IndexedDB
 * or WebCrypto is unavailable.
 */
async function keyForSub(db: IDBDatabase, sub: string): Promise<CryptoKey | null> {
  const meta = (await tx<StoredMeta>(db, META_STORE, "readonly", (s) => s.get(META_KEY) as IDBRequest<StoredMeta>)) ?? null;
  if (meta && meta.sub === sub && meta.key) return meta.key;
  // Different user (or first run) → wipe and mint.
  await tx(db, ENTRY_STORE, "readwrite", (s) => s.clear());
  let key: CryptoKey;
  try { key = await generateCacheKey(); } catch { return null; }
  await tx(db, META_STORE, "readwrite", (s) => s.put({ id: META_KEY, sub, key } satisfies StoredMeta));
  return key;
}

/** Persist one query result for `sub`, encrypted. No-op off the allow-list or when storage is unavailable. */
export async function saveEntry(sub: string, key: readonly unknown[], data: unknown, now = Date.now()): Promise<void> {
  if (!sub || !isCacheableKey(key)) return;
  const db = await openDb();
  if (!db) return;
  try {
    const ck = await keyForSub(db, sub);
    if (!ck) return;
    const { iv, ct } = await encryptJson(ck, data);
    await tx(db, ENTRY_STORE, "readwrite", (s) => s.put({ id: entryId(key), key: [...key], iv: [...iv], ct, at: now } satisfies StoredEntry));
  } finally { db.close(); }
}

/** Load all FRESH entries for `sub`, decrypted. Stale entries are dropped as a side effect. */
export async function loadEntries(sub: string, now = Date.now()): Promise<Array<{ key: unknown[]; data: unknown }>> {
  if (!sub) return [];
  const db = await openDb();
  if (!db) return [];
  try {
    const ck = await keyForSub(db, sub);
    if (!ck) return [];
    const all = (await tx<StoredEntry[]>(db, ENTRY_STORE, "readonly", (s) => s.getAll() as IDBRequest<StoredEntry[]>)) ?? [];
    const out: Array<{ key: unknown[]; data: unknown }> = [];
    for (const e of all) {
      if (!isFresh(e.at, now)) { await tx(db, ENTRY_STORE, "readwrite", (s) => s.delete(e.id)); continue; }
      const data = await decryptJson(ck, new Uint8Array(e.iv), e.ct);
      if (data !== null) out.push({ key: e.key, data });
    }
    return out;
  } finally { db.close(); }
}

/** Wipe the whole offline store (logout / toggle-off). Best-effort. */
export async function clearOfflineCache(): Promise<void> {
  const factory = idb();
  if (!factory) return;
  await new Promise<void>((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = factory.deleteDatabase(DB_NAME); } catch { resolve(); return; }
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
