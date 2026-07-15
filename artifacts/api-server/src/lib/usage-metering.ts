import { sharedKv } from "./shared-state";

/**
 * External-API USAGE METER — counts the calls (and, where known, tokens) OmniProject makes to each
 * third-party VENDOR (the active backend/SOR, each AI provider, FX, …), so an admin can see call
 * volume and cost and get warned before a vendor's own rate/spend limit locks them out.
 *
 * Fleet-wide by construction: every counter is a `sharedKv.incr` (atomic, Redis when REDIS_URL is set,
 * in-process otherwise), so N replicas roll up into ONE total. Recording is best-effort — a metering
 * failure must NEVER fail or slow the underlying call (the callers fire-and-forget).
 *
 * Counters are kept at three granularities (hour / day / month) so a total can be read directly for
 * any of them without summing thousands of fine buckets. Each granularity has its own retention TTL.
 */

export type Metric = "calls" | "tokens";
export type Granularity = "hour" | "day" | "month";

/** Retention per granularity — long enough to render the usual series (last ~48h, ~90d, ~24mo). */
const TTL_MS: Record<Granularity, number> = {
  hour: 3 * 24 * 60 * 60 * 1000, // 3 days of hourly buckets
  day: 100 * 24 * 60 * 60 * 1000, // ~3 months of daily buckets
  month: 800 * 24 * 60 * 60 * 1000, // ~2 years of monthly buckets
};

const PREFIX = "usage:";

/** Vendor ids come from backend/provider names — constrain to a key-safe charset so they can't inject
 *  extra `:` segments into a counter key (and cap the length). */
export function normalizeVendor(vendor: string): string {
  return vendor.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 64) || "unknown";
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** The bucket stamp for a granularity at `now` (UTC): hour=YYYYMMDDHH, day=YYYYMMDD, month=YYYYMM. */
export function bucketStamp(gran: Granularity, now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hr = pad(d.getUTCHours());
  if (gran === "month") return `${y}${mo}`;
  if (gran === "day") return `${y}${mo}${day}`;
  return `${y}${mo}${day}${hr}`;
}

/** The most-recent `count` bucket stamps for a granularity, newest first (for a screen series). */
export function recentStamps(gran: Granularity, count: number, now: number): string[] {
  const n = Math.max(1, Math.min(count, 1000));
  const out: string[] = [];
  if (gran === "month") {
    const d = new Date(now);
    for (let i = 0; i < n; i++) out.push(bucketStamp("month", Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)));
    return out;
  }
  const step = gran === "hour" ? 3_600_000 : 86_400_000;
  for (let i = 0; i < n; i++) out.push(bucketStamp(gran, now - i * step));
  return out;
}

const counterKey = (vendor: string, metric: Metric, gran: Granularity, stamp: string): string =>
  `${PREFIX}${vendor}:${metric}:${gran}:${stamp}`;

/** Coerce a cross-replica counter (anyone reaching the shared KV can write it) to a finite, NON-negative
 *  integer — zero-trust, mirroring lib/ai-governance so a poisoned value can't NaN/negative the totals. */
function clampCounter(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Record usage against a vendor: bump its hour/day/month counters for each supplied metric. Atomic
 * per counter (incr) and best-effort — a shared-store error is swallowed so the caller's real work is
 * never affected. No-op when there's nothing to add.
 */
export async function recordUsage(vendorRaw: string, delta: { calls?: number; tokens?: number }, now: number = Date.now()): Promise<void> {
  const vendor = normalizeVendor(vendorRaw);
  const metrics: [Metric, number][] = [
    ["calls", Math.floor(delta.calls ?? 0)],
    ["tokens", Math.floor(delta.tokens ?? 0)],
  ];
  const ops: Promise<unknown>[] = [];
  for (const [metric, amount] of metrics) {
    if (amount <= 0) continue;
    for (const gran of ["hour", "day", "month"] as Granularity[]) {
      ops.push(sharedKv.incr(counterKey(vendor, metric, gran, bucketStamp(gran, now)), amount, { ttlMs: TTL_MS[gran] }).catch(() => 0));
    }
  }
  await Promise.all(ops);
}

/** The current-period total for one vendor+metric+granularity (used for a live limit check). */
export async function currentTotal(vendorRaw: string, metric: Metric, gran: Granularity, now: number = Date.now()): Promise<number> {
  const key = counterKey(normalizeVendor(vendorRaw), metric, gran, bucketStamp(gran, now));
  return clampCounter(await sharedKv.get(key).catch(() => null));
}

export interface SeriesPoint { stamp: string; calls: number; tokens: number }

/** A newest-first series of `count` buckets for a vendor at a granularity — the screen's chart data. */
export async function usageSeries(vendorRaw: string, gran: Granularity, count: number, now: number = Date.now()): Promise<SeriesPoint[]> {
  const vendor = normalizeVendor(vendorRaw);
  const stamps = recentStamps(gran, count, now);
  const reads = await Promise.all(
    stamps.map(async (stamp) => {
      const [calls, tokens] = await Promise.all([
        sharedKv.get(counterKey(vendor, "calls", gran, stamp)).catch(() => null),
        sharedKv.get(counterKey(vendor, "tokens", gran, stamp)).catch(() => null),
      ]);
      return { stamp, calls: clampCounter(calls), tokens: clampCounter(tokens) };
    }),
  );
  return reads;
}

/** Every vendor that has any recorded usage (scanned from the counter keys). */
export async function knownVendors(): Promise<string[]> {
  const entries = await sharedKv.list(PREFIX).catch(() => []);
  const set = new Set<string>();
  for (const e of entries) {
    const rest = e.key.slice(PREFIX.length);
    const vendor = rest.slice(0, rest.indexOf(":"));
    if (vendor) set.add(vendor);
  }
  return [...set].sort();
}

// ── Limits + cost (policy-driven) ────────────────────────────────────────────────

export interface UsageLimit { period: Granularity; metric: Metric; max: number }
/** Cost per unit: `per` = "call" | "token" | "ktoken" (per 1,000 tokens). */
export interface UsageCost { per: "call" | "token" | "ktoken"; amount: number; currency: string }
export interface UsagePolicy { limit?: UsageLimit; cost?: UsageCost }

export type WarningLevel = "ok" | "notice" | "warn" | "critical" | "over";

const DEFAULT_WARN_BANDS = { notice: 0.5, warn: 0.75, critical: 0.9 } as const;

/** The warning-band fractions, admin-tunable via USAGE_WARN_BANDS="notice,warn,critical" (e.g.
 *  "0.6,0.8,0.95"). Must be three strictly-increasing fractions in (0,1); anything malformed falls
 *  back to the 0.5 / 0.75 / 0.9 defaults. */
function warnBands(): { notice: number; warn: number; critical: number } {
  const raw = process.env["USAGE_WARN_BANDS"]?.trim();
  if (!raw) return DEFAULT_WARN_BANDS;
  const p = raw.split(",").map((s) => Number(s.trim()));
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n) || n <= 0 || n >= 1)) return DEFAULT_WARN_BANDS;
  const [notice, warn, critical] = p as [number, number, number];
  if (!(notice < warn && warn < critical)) return DEFAULT_WARN_BANDS;
  return { notice, warn, critical };
}

/** Map a fraction-of-limit to a warning band (default 50% notice, 75% warn, 90% critical, ≥100% over;
 *  the notice/warn/critical thresholds are tunable via USAGE_WARN_BANDS). */
export function warningLevel(fraction: number): WarningLevel {
  const b = warnBands();
  if (fraction >= 1) return "over";
  if (fraction >= b.critical) return "critical";
  if (fraction >= b.warn) return "warn";
  if (fraction >= b.notice) return "notice";
  return "ok";
}

export interface LimitStatus { period: Granularity; metric: Metric; max: number; used: number; fraction: number; level: WarningLevel }

/** Resolve a vendor's limit status for the current period (null when no limit is configured). */
export async function limitStatus(vendorRaw: string, limit: UsageLimit | undefined, now: number = Date.now()): Promise<LimitStatus | null> {
  if (!limit || limit.max <= 0) return null;
  const used = await currentTotal(vendorRaw, limit.metric, limit.period, now);
  const fraction = used / limit.max;
  return { period: limit.period, metric: limit.metric, max: limit.max, used, fraction, level: warningLevel(fraction) };
}

/** Money cost of a usage point under a cost policy (0 when no cost is configured). */
export function pointCost(point: { calls: number; tokens: number }, cost: UsageCost | undefined): number {
  if (!cost || cost.amount <= 0) return 0;
  if (cost.per === "call") return point.calls * cost.amount;
  if (cost.per === "ktoken") return (point.tokens / 1000) * cost.amount;
  return point.tokens * cost.amount; // per token
}
