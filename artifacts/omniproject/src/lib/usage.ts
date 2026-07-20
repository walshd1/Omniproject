import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * External-API usage client — reads the per-vendor call/token volume + limit/cost report, and writes
 * the admin-entered per-vendor limits + costs. Mirrors the gateway's routes/usage.ts contract.
 */

export type Granularity = "hour" | "day" | "month";
export type Metric = "calls" | "tokens";
export type WarningLevel = "ok" | "notice" | "warn" | "critical" | "over";

export interface SeriesPoint { stamp: string; calls: number; tokens: number }
export interface UsageLimit { period: Granularity; metric: Metric; max: number }
export interface UsageCost { per: "call" | "token" | "ktoken"; amount: number; currency: string }
export interface UsagePolicy { limit?: UsageLimit; cost?: UsageCost }

export interface LimitStatus {
  period: Granularity; metric: Metric; max: number; used: number; fraction: number; level: WarningLevel;
}

export interface VendorUsage {
  vendor: string;
  series: { hour: SeriesPoint[]; day: SeriesPoint[]; month: SeriesPoint[] };
  totals: Record<Granularity, { calls: number; tokens: number }>;
  limit: LimitStatus | null;
  cost: { currency: string; day: number; month: number } | null;
  policy: UsagePolicy;
}

export interface UsageReport { generatedAt: string; vendors: VendorUsage[] }

/** The live per-vendor usage report (pmo/admin). Polls modestly — usage moves slowly. */
export function useUsageReport() {
  return useQuery<UsageReport>({
    queryKey: ["usage-report"],
    queryFn: () => getJson("/api/usage"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** The admin-entered per-vendor limits + costs. */
export function useUsagePolicies() {
  return useQuery<{ usagePolicies: Record<string, UsagePolicy> }>({
    queryKey: ["usage-policies"],
    queryFn: () => getJson("/api/usage/policies"),
    staleTime: 30_000,
  });
}

/** Persist the per-vendor limits + costs (pmo/admin). */
export async function saveUsagePolicies(usagePolicies: Record<string, UsagePolicy>): Promise<void> {
  await sendJson("/api/usage/policies", { usagePolicies }, "PUT", "Failed to save usage policies");
}

export interface NotifyResult {
  worst: WarningLevel;
  flagged: (LimitStatus & { vendor: string })[];
  notified: boolean;
}

/** The shortcut: push the current usage-vs-limit status to the caller as a notification. */
export async function runUsageNotify(): Promise<NotifyResult> {
  return sendJson<NotifyResult>("/api/usage/notify", undefined, "POST", "Failed to send usage notification");
}
