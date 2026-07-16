import { describe, it, expect } from "vitest";
import {
  isCacheableKey, isFresh, entryId, generateCacheKey, encryptJson, decryptJson,
  saveEntry, loadEntries, clearOfflineCache, OFFLINE_TTL_MS,
} from "./offline-cache";

/**
 * The encrypted offline cache — allow-list + freshness (pure) and the AES-GCM crypto core. The IndexedDB
 * adapter degrades to a safe no-op in jsdom (no `indexedDB`), which is asserted here too.
 */
describe("allow-list + freshness", () => {
  it("caches ONLY the my-work/tasks read-model keys", () => {
    expect(isCacheableKey(["tasks", "all"])).toBe(true);
    expect(isCacheableKey(["my-work-issues", "proj-1"])).toBe(true);
    expect(isCacheableKey(["wiki", "docs"])).toBe(false);
    expect(isCacheableKey(["projects"])).toBe(false);
    expect(isCacheableKey([])).toBe(false);
  });

  it("expires an entry after the TTL", () => {
    const now = 1_000_000_000;
    expect(isFresh(now, now)).toBe(true);
    expect(isFresh(now - (OFFLINE_TTL_MS - 1), now)).toBe(true);
    expect(isFresh(now - OFFLINE_TTL_MS, now)).toBe(false);
    expect(isFresh(now + 5, now)).toBe(false); // a future stamp (clock skew) is not "fresh"
  });

  it("derives a stable entry id from the query key", () => {
    expect(entryId(["tasks", "all"])).toBe('["tasks","all"]');
  });
});

describe("AES-GCM crypto core", () => {
  it("round-trips a value through a non-extractable key", async () => {
    const key = await generateCacheKey();
    expect(key.extractable).toBe(false);
    const { iv, ct } = await encryptJson(key, { a: 1, b: ["x", "y"] });
    expect(await decryptJson(key, iv, ct)).toEqual({ a: 1, b: ["x", "y"] });
  });

  it("returns null when decrypting with the WRONG key (no cross-user read)", async () => {
    const k1 = await generateCacheKey();
    const k2 = await generateCacheKey();
    const { iv, ct } = await encryptJson(k1, { secret: true });
    expect(await decryptJson(k2, iv, ct)).toBeNull();
  });

  it("returns null on tampered ciphertext (GCM auth tag fails)", async () => {
    const key = await generateCacheKey();
    const { iv, ct } = await encryptJson(key, { ok: 1 });
    const bytes = new Uint8Array(ct); bytes[0] ^= 0xff;
    expect(await decryptJson(key, iv, bytes.buffer)).toBeNull();
  });
});

describe("IndexedDB adapter degrades safely without indexedDB (jsdom)", () => {
  it("saveEntry / loadEntries / clearOfflineCache are no-ops that never throw", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await saveEntry("u1", ["tasks", "all"], [{ id: "t1" }]); // no throw
    expect(await loadEntries("u1")).toEqual([]);
    await clearOfflineCache(); // no throw
  });

  it("saveEntry ignores keys off the allow-list", async () => {
    await saveEntry("u1", ["projects"], [{ id: "p1" }]); // no throw, nothing cached
    expect(await loadEntries("u1")).toEqual([]);
  });
});
