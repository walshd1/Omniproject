import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isCacheableKey, isFresh, entryId, generateCacheKey, encryptJson, decryptJson,
  saveEntry, loadEntries, clearOfflineCache, OFFLINE_TTL_MS,
} from "./offline-cache";

/**
 * The encrypted offline cache — allow-list + freshness (pure) and the AES-GCM crypto core. The IndexedDB
 * adapter degrades to a safe no-op in jsdom (no `indexedDB`), which is asserted here; a minimal in-memory
 * IndexedDB fake then exercises the full save/load/wipe adapter, its error arms, and the WebCrypto guards.
 */

afterEach(() => vi.unstubAllGlobals());

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

describe("WebCrypto guards (subtle unavailable)", () => {
  it("generateCacheKey / encryptJson throw and decryptJson returns null without crypto.subtle", async () => {
    const key = await generateCacheKey(); // mint with real crypto first
    const { iv, ct } = await encryptJson(key, { x: 1 });
    vi.stubGlobal("crypto", {}); // no .subtle
    await expect(generateCacheKey()).rejects.toThrow("WebCrypto unavailable");
    await expect(encryptJson(key, { x: 1 })).rejects.toThrow("WebCrypto unavailable");
    expect(await decryptJson(key, iv, ct)).toBeNull();
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

  it("saveEntry ignores an empty sub, and loadEntries returns [] for an empty sub", async () => {
    await saveEntry("", ["tasks", "all"], [{ id: "t1" }]);
    expect(await loadEntries("")).toEqual([]);
  });
});

// ── A minimal in-memory IndexedDB fake ──────────────────────────────────────────────────────────────────
// Enough of the IDB surface the adapter uses (open/upgrade/transaction/get/getAll/put/clear/delete/delete-db).
// Object references are stored as-is (no structured clone), so a real non-extractable CryptoKey persists —
// letting the true crypto path run end-to-end.

interface FakeOpts {
  openMode?: "ok" | "throw" | "error";
  transactionThrows?: boolean;
  failGetAll?: boolean;
  deleteMode?: "ok" | "throw" | "error" | "blocked";
}

function createFakeIndexedDB(opts: FakeOpts = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  type Req = { onsuccess: (() => void) | null; onerror: (() => void) | null; result?: unknown };
  const request = (result: unknown, fail = false): Req => {
    const req: Req = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => {
      if (fail) { req.onerror?.(); return; }
      req.result = result;
      req.onsuccess?.();
    }, 0);
    return req;
  };
  const makeStore = (name: string) => {
    const map = stores.get(name)!;
    return {
      get: (k: string) => request(map.get(k)),
      getAll: () => (opts.failGetAll ? request(undefined, true) : request([...map.values()])),
      put: (v: { id: string }) => { map.set(v.id, v); return request(undefined); },
      clear: () => { map.clear(); return request(undefined); },
      delete: (k: string) => { map.delete(k); return request(undefined); },
    };
  };
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => { stores.set(n, new Map()); return makeStore(n); },
    transaction: (_n: string, _mode?: string) => {
      if (opts.transactionThrows) throw new Error("tx blocked");
      return { objectStore: (s: string) => makeStore(s) };
    },
    close: () => {},
  };
  return {
    open: (_name: string, _v: number) => {
      if (opts.openMode === "throw") throw new Error("open blocked");
      const req: { onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null; result: unknown } =
        { onupgradeneeded: null, onsuccess: null, onerror: null, result: db };
      setTimeout(() => {
        if (opts.openMode === "error") { req.onerror?.(); return; }
        req.onupgradeneeded?.(); // idempotent: adapter guards createObjectStore on contains()
        req.onsuccess?.();
      }, 0);
      return req;
    },
    deleteDatabase: (_n: string) => {
      if (opts.deleteMode === "throw") throw new Error("delete blocked");
      const req: { onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null } =
        { onsuccess: null, onerror: null, onblocked: null };
      setTimeout(() => {
        if (opts.deleteMode === "error") req.onerror?.();
        else if (opts.deleteMode === "blocked") req.onblocked?.();
        else req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

describe("IndexedDB adapter (in-memory fake)", () => {
  it("saves an encrypted entry and loads it back decrypted", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    await saveEntry("userA", ["tasks", "all"], [{ id: "t1", title: "do it" }]);
    const loaded = await loadEntries("userA");
    expect(loaded).toEqual([{ key: ["tasks", "all"], data: [{ id: "t1", title: "do it" }] }]);
  });

  it("reuses the same cache key across writes for the same user", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    await saveEntry("userA", ["tasks", "all"], [{ id: "t1" }]);
    await saveEntry("userA", ["my-work-issues", "p1"], [{ id: "i1" }]);
    const loaded = await loadEntries("userA");
    expect(loaded).toHaveLength(2);
    expect(loaded.map((e) => e.key[0]).sort()).toEqual(["my-work-issues", "tasks"]);
  });

  it("wipes and re-keys when a DIFFERENT user opens the store (no cross-user read)", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    await saveEntry("userA", ["tasks", "all"], [{ id: "secret" }]);
    // userB opening the store wipes userA's entries and mints a fresh key.
    await saveEntry("userB", ["tasks", "mine"], [{ id: "b1" }]);
    expect((await loadEntries("userB")).map((e) => e.key)).toEqual([["tasks", "mine"]]);
    // userA can no longer read anything — the store was wiped when userB took it over.
    expect(await loadEntries("userA")).toEqual([]);
  });

  it("drops stale entries on load (past the TTL)", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    const t0 = 1_000_000_000;
    await saveEntry("userA", ["tasks", "all"], [{ id: "old" }], t0);
    const loaded = await loadEntries("userA", t0 + OFFLINE_TTL_MS + 1);
    expect(loaded).toEqual([]);
    // The stale entry was deleted as a side effect — a fresh load (in-window) sees nothing.
    expect(await loadEntries("userA", t0 + OFFLINE_TTL_MS + 2)).toEqual([]);
  });

  it("keeps fresh entries within the TTL window", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    const t0 = 2_000_000_000;
    await saveEntry("userA", ["tasks", "all"], [{ id: "new" }], t0);
    expect(await loadEntries("userA", t0 + 1000)).toHaveLength(1);
  });

  it("clearOfflineCache resolves on a successful deleteDatabase", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    await expect(clearOfflineCache()).resolves.toBeUndefined();
  });

  it("clearOfflineCache resolves when deleteDatabase errors or is blocked, or throws", async () => {
    for (const deleteMode of ["error", "blocked", "throw"] as const) {
      vi.stubGlobal("indexedDB", createFakeIndexedDB({ deleteMode }));
      await expect(clearOfflineCache()).resolves.toBeUndefined();
    }
  });
});

describe("IndexedDB adapter error arms", () => {
  it("openDb returns null when factory.open throws → save/load are no-ops", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB({ openMode: "throw" }));
    await expect(saveEntry("userA", ["tasks", "all"], [{ id: "t1" }])).resolves.toBeUndefined();
    expect(await loadEntries("userA")).toEqual([]);
  });

  it("openDb returns null when the open request errors", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB({ openMode: "error" }));
    await saveEntry("userA", ["tasks", "all"], [{ id: "t1" }]);
    expect(await loadEntries("userA")).toEqual([]);
  });

  it("tolerates a transaction that throws (tx catch arm)", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB({ transactionThrows: true }));
    await expect(saveEntry("userA", ["tasks", "all"], [{ id: "t1" }])).resolves.toBeUndefined();
    expect(await loadEntries("userA")).toEqual([]);
  });

  it("tolerates a failing getAll request (tx onerror arm)", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB({ failGetAll: true }));
    await saveEntry("userA", ["tasks", "all"], [{ id: "t1" }]);
    expect(await loadEntries("userA")).toEqual([]);
  });

  it("returns null from keyForSub (no save) when key generation fails", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    vi.stubGlobal("crypto", { subtle: { generateKey: vi.fn(() => Promise.reject(new Error("no key"))) }, getRandomValues: (a: Uint8Array) => a });
    await expect(saveEntry("userA", ["tasks", "all"], [{ id: "t1" }])).resolves.toBeUndefined();
    expect(await loadEntries("userA")).toEqual([]);
  });
});
