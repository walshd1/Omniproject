import type { KvRedis } from "../lib/shared-state";

/**
 * In-memory Redis double for unit tests — no live server in this env. It implements the exact
 * `KvRedis` contract the `RedisKv` backend calls (GET/SET/DEL/SCAN/MGET/INCRBY/PEXPIRE/EVAL),
 * so tests drive the real Redis-shaped code path (native INCRBY, the atomic CAS Lua, SCAN
 * cursoring) rather than the in-process backend.
 *
 * Every method body runs synchronously with NO internal `await`, mirroring Redis's single-
 * threaded, one-command-at-a-time execution: a call completes atomically before the next
 * microtask observes the store, which is what makes concurrent INCRBY / CAS serialise here
 * exactly as they would server-side.
 *
 * HONEST LIMIT: this proves the backend's protocol + logic, not the real server's atomicity —
 * the Lua's indivisibility can only be verified against a live Redis.
 */
export class FakeRedis implements KvRedis {
  private readonly map = new Map<string, { value: string; expiresAt: number | null }>();
  /** Command counter — lets a test assert INCRBY/EVAL were the native ops actually invoked. */
  public calls: Record<string, number> = {};

  private note(op: string): void { this.calls[op] = (this.calls[op] ?? 0) + 1; }

  private live(k: string): string | null {
    const e = this.map.get(k);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) { this.map.delete(k); return null; }
    return e.value;
  }

  async get(k: string): Promise<string | null> { this.note("get"); return this.live(k); }

  async set(k: string, v: string, mode?: string, ttl?: number): Promise<unknown> {
    this.note("set");
    const expiresAt = mode === "PX" && typeof ttl === "number" ? Date.now() + ttl : null;
    this.map.set(k, { value: v, expiresAt });
    return "OK";
  }

  async del(k: string): Promise<unknown> { this.note("del"); return this.map.delete(k) ? 1 : 0; }

  async mget(...keys: string[]): Promise<(string | null)[]> { this.note("mget"); return keys.map((k) => this.live(k)); }

  async incrby(k: string, by: number): Promise<number> {
    this.note("incrby");
    const cur = Number(this.live(k) ?? 0);
    const next = cur + by;
    // INCRBY preserves any existing TTL.
    const e = this.map.get(k);
    this.map.set(k, { value: String(next), expiresAt: e?.expiresAt ?? null });
    return next;
  }

  async pexpire(k: string, ms: number): Promise<unknown> {
    this.note("pexpire");
    const e = this.map.get(k);
    if (!e) return 0;
    e.expiresAt = Date.now() + ms;
    return 1;
  }

  /** SCAN with `MATCH <literal>*`. Returns everything in one page (cursor "0"), like a small DB. */
  async scan(_cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    this.note("scan");
    let match = "*";
    for (let i = 0; i < args.length - 1; i++) if (String(args[i]).toUpperCase() === "MATCH") match = String(args[i + 1]);
    const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
    const out: string[] = [];
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix) && this.live(k) !== null) out.push(k);
    return ["0", out];
  }

  /** Executes the backend's CAS Lua by its documented ARGV contract (a faithful JS re-impl). */
  async eval(_script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    this.note("eval");
    const [key, expectFlag, expected, next, ttl] = args.map(String);
    const cur = this.live(key!); // Redis Lua sees `false` for absent; here that maps to null
    if (expectFlag === "1") {
      if (cur === null || cur !== expected) return 0;
    } else if (cur !== null) {
      return 0;
    }
    const expiresAt = ttl !== "0" ? Date.now() + Number(ttl) : null;
    this.map.set(key!, { value: next!, expiresAt });
    return 1;
  }
}
