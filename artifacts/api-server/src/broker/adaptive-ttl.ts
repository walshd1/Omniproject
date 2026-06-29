/**
 * Latency-aware adaptive TTL for the opt-in read cache.
 *
 * The fixed `READ_CACHE_TTL_MS` treats every read the same. But caching pays off in proportion to how
 * SLOW the upstream call is: caching an 800 ms portfolio rollup saves far more than caching a 30 ms
 * list — and adding staleness to an already-fast read buys almost nothing. So, when
 * `READ_CACHE_ADAPTIVE=true`, this module tunes the TTL per broker method from the method's MEASURED
 * upstream latency (an EWMA recorded on every real cache miss).
 *
 * The model is COMBINED (threshold floor + clamped scaling):
 *   - below a latency THRESHOLD the method is already fast ⇒ TTL 0 (don't cache it at all);
 *   - above it, TTL = clamp(MIN, MAX, factor × latency) — slow methods cache longer, up to a MAX that
 *     is the explicit staleness ceiling you accept.
 * Until a method has a measurement (cold start) it falls back to the configured baseline TTL.
 *
 * This only ever modulates the EXISTING opt-in cache (it's inert unless `READ_CACHE_TTL_MS>0` keeps
 * the cache wrapped); it never makes a read cacheable that the cache layer wouldn't already serve.
 * Per-replica, in memory — like the cache itself.
 */

const ewma = new Map<string, number>();
const ALPHA = 0.3; // weight on the newest sample; ~last few calls dominate.

function envNum(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/** Is latency-aware TTL switched on? */
export function adaptiveEnabled(): boolean {
  return /^(1|true)$/i.test((process.env["READ_CACHE_ADAPTIVE"] ?? "").trim());
}

/** Latency at/under which a method is "already fast" and isn't cached (ms). */
export function thresholdMs(): number { return envNum("READ_CACHE_ADAPTIVE_THRESHOLD_MS", 150); }
/** TTL ≈ factor × measured latency, before clamping. */
export function adaptiveFactor(): number { return envNum("READ_CACHE_ADAPTIVE_FACTOR", 6); }
/** Lower clamp on an adaptive TTL (ms). */
export function minTtlMs(): number { return envNum("READ_CACHE_MIN_TTL_MS", 1000); }
/** Upper clamp on an adaptive TTL — the staleness ceiling you accept (ms). */
export function maxTtlMs(): number { return envNum("READ_CACHE_MAX_TTL_MS", 60_000); }

/** Fold a measured upstream latency (ms) for a method into its EWMA. */
export function recordLatency(method: string, ms: number): void {
  if (!(ms >= 0)) return;
  const prev = ewma.get(method);
  ewma.set(method, prev === undefined ? ms : ALPHA * ms + (1 - ALPHA) * prev);
}

/** The current smoothed latency for a method, or undefined before the first sample. */
export function methodLatency(method: string): number | undefined {
  return ewma.get(method);
}

/**
 * The effective TTL (ms) for a method given the configured baseline. With adaptive off, returns the
 * baseline unchanged. With it on: baseline until measured (cold start); 0 below the threshold (skip
 * caching a fast method); else clamp(MIN, MAX, factor × latency).
 */
export function adaptiveTtl(method: string, baseTtlMs: number): number {
  if (!adaptiveEnabled()) return baseTtlMs;
  const lat = ewma.get(method);
  if (lat === undefined) return baseTtlMs;           // cold start → baseline
  if (lat < thresholdMs()) return 0;                 // already fast → don't cache
  const scaled = Math.round(adaptiveFactor() * lat);
  return Math.min(maxTtlMs(), Math.max(minTtlMs(), scaled));
}

/** Diagnostics for dev mode: config + per-method measured latency and the TTL it currently chooses. */
export function adaptiveStats(baseTtlMs: number): {
  enabled: boolean; thresholdMs: number; factor: number; minTtlMs: number; maxTtlMs: number;
  methods: Record<string, { ewmaMs: number; ttlMs: number }>;
} {
  const methods: Record<string, { ewmaMs: number; ttlMs: number }> = {};
  for (const [method, lat] of ewma) {
    methods[method] = { ewmaMs: Math.round(lat), ttlMs: adaptiveTtl(method, baseTtlMs) };
  }
  return {
    enabled: adaptiveEnabled(), thresholdMs: thresholdMs(), factor: adaptiveFactor(),
    minTtlMs: minTtlMs(), maxTtlMs: maxTtlMs(), methods,
  };
}

/** Test-only: forget all measured latencies. */
export function resetAdaptive(): void {
  ewma.clear();
}
