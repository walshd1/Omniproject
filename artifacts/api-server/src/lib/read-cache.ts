/**
 * Short-TTL read cache — scaffolding for the optional scale relaxation
 * (RFC-002 §H). It is **off by default** (`READ_CACHE_TTL_MS` unset/0), so wiring
 * it changes nothing until an operator opts in. When the n8n load numbers call
 * for it, a hot read becomes `getReadCache().wrap(key, () => broker.read(...))`.
 *
 * Ephemeral, in-process, same trust class as the other read-through paths — it
 * never persists and holds nothing across a restart. Deliberately tiny.
 */
import { lazySingleton } from "./lazy-singleton";

interface Entry {
  value: unknown;
  exp: number;
}

export class ReadCache {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly ttlMs: number) {}

  /** True only when a positive TTL was configured. */
  enabled(): boolean {
    return this.ttlMs > 0;
  }

  get<T>(key: string, now = Date.now()): T | undefined {
    if (!this.enabled()) return undefined;
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp <= now) {
      this.store.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set(key: string, value: unknown, now = Date.now()): void {
    if (!this.enabled()) return;
    this.store.set(key, { value, exp: now + this.ttlMs });
  }

  /** Memoise an async read for the TTL. With the cache disabled this is a
   *  transparent pass-through (always calls `fn`), so callers can wrap a read
   *  unconditionally and the behaviour only changes when opted in. */
  async wrap<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}

const cacheSingleton = lazySingleton(() => new ReadCache(Number(process.env["READ_CACHE_TTL_MS"]) || 0));

/** The process-wide read cache, configured from `READ_CACHE_TTL_MS` (default 0 =
 *  disabled). Selected once. */
export function getReadCache(): ReadCache {
  return cacheSingleton.get();
}
