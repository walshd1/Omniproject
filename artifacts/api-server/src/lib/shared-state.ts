import { logger } from "./logger";
import { loadOptionalDependency } from "./optional-dependency";

/**
 * Shared-state seam (roadmap §2) — an OPT-IN key/value store the per-replica registries can
 * adopt so their state is consistent fleet-wide instead of per-process.
 *
 * Several runtime registries are in-process RAM by design (fast, zero-dependency). Behind N
 * replicas that means each has its own copy. This seam gives them ONE shared backing — when
 * `REDIS_URL` is set (and `ioredis` is installed) the store is Redis; otherwise it's an
 * in-process map with identical semantics, so a single-instance deployment is unchanged and
 * carries no dependency.
 *
 * Mirrors the rate-limit / broker-log Redis pattern exactly:
 *  - `ioredis` is a RUNTIME-OPTIONAL dependency loaded via a variable-specifier dynamic import,
 *    so it's never a committed dependency and a default/CI install stays lean;
 *  - REDIS_URL-set-but-not-installed logs ONCE and falls back to in-process (never crashes);
 *  - a stable facade (`sharedKv`) delegates to the active backend, swapped in after async init,
 *    so adopters import a fixed handle and never see the swap.
 *
 * The store is async (I/O), so only registries whose accessors are already async should adopt
 * it directly; a sync hot-path registry (e.g. the per-request session cap) would need an async
 * refactor first and stays per-replica until then.
 */

export type SharedStateMode = "in-process" | "redis";

/** A minimal async KV the registries use; both backends implement it identically. */
export interface SharedKv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ttlMs?: number }): Promise<void>;
  del(key: string): Promise<void>;
  /** Every {key,value} whose key starts with `prefix` (for small queue-like sets). */
  list(prefix: string): Promise<{ key: string; value: string }[]>;
  /** Test/admin: drop everything under `prefix` (or all when omitted). */
  clear(prefix?: string): Promise<void>;
  /**
   * Atomically add `by` (default 1) to the integer at `key` (absent ⇒ 0) and return the NEW
   * value. Redis uses native INCRBY; the in-process backend uses a synchronous critical
   * section. `ttlMs` (re)sets the key's expiry; omitted preserves any existing expiry.
   */
  incr(key: string, by?: number, opts?: { ttlMs?: number }): Promise<number>;
  /**
   * Atomic compare-and-set: store `next` at `key` ONLY if its current value equals `expected`
   * (`null` means "expect absent"). Returns true iff the swap happened. This is the enabler for
   * a fork-free shared chain head — Redis runs it as an atomic Lua GET+SET, the in-process
   * backend as a synchronous critical section. Because the compared value always encodes a
   * monotonic sequence it never repeats, so there is no ABA hazard.
   */
  cas(key: string, expected: string | null, next: string, opts?: { ttlMs?: number }): Promise<boolean>;
}

const NS = "omni:ss:";

// ── In-process backend (default) ──────────────────────────────────────────────────
class InProcessKv implements SharedKv {
  private readonly map = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string): string | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) { this.map.delete(key); return null; }
    return e.value;
  }
  async get(key: string): Promise<string | null> { return this.live(key); }
  async set(key: string, value: string, opts?: { ttlMs?: number }): Promise<void> {
    this.map.set(key, { value, expiresAt: opts?.ttlMs ? Date.now() + opts.ttlMs : null });
  }
  async del(key: string): Promise<void> { this.map.delete(key); }
  async list(prefix: string): Promise<{ key: string; value: string }[]> {
    const out: { key: string; value: string }[] = [];
    for (const key of [...this.map.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const value = this.live(key);
      if (value !== null) out.push({ key, value });
    }
    return out;
  }
  async clear(prefix?: string): Promise<void> {
    if (!prefix) { this.map.clear(); return; }
    for (const key of [...this.map.keys()]) if (key.startsWith(prefix)) this.map.delete(key);
  }
  // incr/cas run their whole read→decide→write body with NO `await`, so in single-threaded JS
  // each call completes atomically before the next microtask can observe or mutate the entry —
  // that synchronous critical section is what serialises concurrent callers.
  async incr(key: string, by: number = 1, opts?: { ttlMs?: number }): Promise<number> {
    const e = this.map.get(key);
    const alive = e && (e.expiresAt === null || e.expiresAt > Date.now());
    const next = (alive ? Number(e!.value) || 0 : 0) + by;
    const expiresAt = opts?.ttlMs ? Date.now() + opts.ttlMs : (alive ? e!.expiresAt : null);
    this.map.set(key, { value: String(next), expiresAt });
    return next;
  }
  async cas(key: string, expected: string | null, next: string, opts?: { ttlMs?: number }): Promise<boolean> {
    if (this.live(key) !== expected) return false;
    this.map.set(key, { value: next, expiresAt: opts?.ttlMs ? Date.now() + opts.ttlMs : null });
    return true;
  }
}

// ── Redis backend (when REDIS_URL + ioredis present) ───────────────────────────────
/** The subset of the ioredis client this backend uses (also the contract a test double meets). */
export interface KvRedis {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, mode?: string, ttl?: number): Promise<unknown>;
  del(k: string): Promise<unknown>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  incrby(k: string, by: number): Promise<number>;
  pexpire(k: string, ms: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Atomic compare-and-set as a single Lua script — Redis runs it uninterrupted, so GET + the
 * conditional SET happen as one indivisible step. Contract:
 *   KEYS[1] = key; ARGV[1] = "1" expect a value / "0" expect absent; ARGV[2] = expected value;
 *   ARGV[3] = next value; ARGV[4] = ttl ms ("0" ⇒ no expiry). Returns 1 on swap, else 0.
 * (Redis GET on a missing key yields Lua `false`.) The in-process backend mirrors these exact
 * semantics in a synchronous critical section.
 */
const CAS_LUA = `
local cur = redis.call('GET', KEYS[1])
if ARGV[1] == '1' then
  if cur == false or cur ~= ARGV[2] then return 0 end
else
  if cur ~= false then return 0 end
end
if ARGV[4] == '0' then
  redis.call('SET', KEYS[1], ARGV[3])
else
  redis.call('SET', KEYS[1], ARGV[3], 'PX', tonumber(ARGV[4]))
end
return 1`;

class RedisKv implements SharedKv {
  constructor(private readonly client: KvRedis) {}
  async get(key: string): Promise<string | null> { return this.client.get(NS + key); }
  async set(key: string, value: string, opts?: { ttlMs?: number }): Promise<void> {
    if (opts?.ttlMs) await this.client.set(NS + key, value, "PX", opts.ttlMs);
    else await this.client.set(NS + key, value);
  }
  async del(key: string): Promise<void> { await this.client.del(NS + key); }
  async list(prefix: string): Promise<{ key: string; value: string }[]> {
    const match = `${NS}${prefix}*`;
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.client.scan(cursor, "MATCH", match, "COUNT", 200);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    if (!keys.length) return [];
    const values = await this.client.mget(...keys);
    const out: { key: string; value: string }[] = [];
    keys.forEach((k, i) => { const v = values[i]; if (v !== null && v !== undefined) out.push({ key: k.slice(NS.length), value: v }); });
    return out;
  }
  async clear(prefix?: string): Promise<void> {
    const match = `${NS}${prefix ?? ""}*`;
    let cursor = "0";
    do {
      const [next, batch] = await this.client.scan(cursor, "MATCH", match, "COUNT", 200);
      for (const k of batch) await this.client.del(k);
      cursor = next;
    } while (cursor !== "0");
  }
  async incr(key: string, by: number = 1, opts?: { ttlMs?: number }): Promise<number> {
    const v = await this.client.incrby(NS + key, by); // native atomic
    if (opts?.ttlMs) await this.client.pexpire(NS + key, opts.ttlMs);
    return v;
  }
  async cas(key: string, expected: string | null, next: string, opts?: { ttlMs?: number }): Promise<boolean> {
    const res = await this.client.eval(
      CAS_LUA, 1, NS + key,
      expected === null ? "0" : "1",
      expected ?? "",
      next,
      String(opts?.ttlMs ?? 0),
    );
    return res === 1 || res === "1";
  }
}

// ── Facade: stable handle, backend swapped in after async init ──────────────────────
let mode: SharedStateMode = "in-process";
let active: SharedKv = new InProcessKv();
let ready: Promise<void> | null = null;

/** Whether shared state is per-replica ("in-process") or fleet-wide ("redis"). */
export function sharedStateMode(): SharedStateMode { return mode; }

async function initRedis(url: string): Promise<void> {
  const Redis = await loadOptionalDependency<new (u: string) => KvRedis>(
    "ioredis",
    (mod) => (mod as { default?: new (u: string) => KvRedis } | null)?.default,
    "shared state: REDIS_URL set but 'ioredis' is not installed — registries stay PER-REPLICA. Run: pnpm --filter @workspace/api-server add ioredis",
  );
  if (!Redis) return;
  try {
    active = new RedisKv(new Redis(url));
    mode = "redis";
    logger.info("shared state: Redis backing enabled (registries shared fleet-wide)");
  } catch (err) {
    logger.warn({ err }, "shared state: Redis init failed — registries remain per-replica");
  }
}

const redisUrl = process.env["REDIS_URL"]?.trim();
if (redisUrl) ready = initRedis(redisUrl);

/** The shared KV. Adopters import this fixed handle; each call awaits readiness then routes to
 *  the active backend (in-process until Redis finishes connecting, if configured). */
export const sharedKv: SharedKv = {
  async get(key) { if (ready) await ready; return active.get(key); },
  async set(key, value, opts) { if (ready) await ready; return active.set(key, value, opts); },
  async del(key) { if (ready) await ready; return active.del(key); },
  async list(prefix) { if (ready) await ready; return active.list(prefix); },
  async clear(prefix) { if (ready) await ready; return active.clear(prefix); },
  async incr(key, by, opts) { if (ready) await ready; return active.incr(key, by, opts); },
  async cas(key, expected, next, opts) { if (ready) await ready; return active.cas(key, expected, next, opts); },
};

// ── Shared bounded ring (fleet-wide "recent N events") ──────────────────────────────
// A best-effort, fleet-visible ring built on the atomic primitives: `incr` hands each push a
// monotonic slot, entries live at `${prefix}e:<zero-padded-seq>`, and each push trims the one
// entry that just fell outside the window — so the set stays ~`max` without a sweep. Reads sort
// by key (== insertion order) and take the last `max`. Adopters keep their local RAM ring as the
// fast cache and use this only to reflect siblings' entries when Redis is configured.
const RING_SEQ = "seq";
const pad = (n: number): string => String(n).padStart(20, "0");

/** Append `value` to the shared ring under `prefix`, keeping at most ~`max` entries. */
export async function sharedRingPush(prefix: string, value: string, max: number, opts?: { ttlMs?: number }): Promise<void> {
  const seq = await sharedKv.incr(prefix + RING_SEQ, 1, opts);
  await sharedKv.set(`${prefix}e:${pad(seq)}`, value, opts);
  if (seq > max) await sharedKv.del(`${prefix}e:${pad(seq - max)}`); // evict the one that aged out
}

/** The shared ring's entries under `prefix`, oldest→newest, capped at `max`. */
export async function sharedRingRead(prefix: string, max: number): Promise<string[]> {
  const entries = await sharedKv.list(`${prefix}e:`);
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries.slice(-max).map((e) => e.value);
}

/** Test-only: reset to a fresh in-process backend (drops any Redis binding + data). */
export function __resetSharedStateForTest(): void {
  mode = "in-process";
  active = new InProcessKv();
  ready = null;
}

/** Test-only: bind the shared KV to a Redis-shaped double so the RedisKv backend (native
 *  INCRBY / the atomic CAS Lua / SCAN) is exercised without a live Redis server. */
export function __setRedisKvForTest(client: KvRedis): void {
  active = new RedisKv(client);
  mode = "redis";
  ready = null;
}
