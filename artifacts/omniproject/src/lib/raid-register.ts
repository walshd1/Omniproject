/**
 * RAID register roll-up — counts the project's Risks, Assumptions, Issues and Dependencies by type and
 * by severity, and flags how many are still open. Derive-only over the backend's RAID log
 * (`get_project_raid`); OmniProject stores nothing. Unknown types/severities are tolerated (bucketed
 * under "other") so a backend with its own taxonomy still summarises.
 */

export interface RaidItem {
  type?: string | null;
  severity?: string | null;
  status?: string | null;
}

export type RaidType = "risk" | "assumption" | "issue" | "dependency";
export type RaidSeverity = "high" | "medium" | "low";

export interface RaidSummary {
  total: number;
  /** Count per RAID type (always has all four keys, plus a catch-all). */
  byType: Record<RaidType | "other", number>;
  /** Count per severity band. */
  bySeverity: Record<RaidSeverity | "other", number>;
  /** Items not in a closed/done/cancelled state — the live exposure. */
  openItems: number;
}

const TYPES: RaidType[] = ["risk", "assumption", "issue", "dependency"];
const SEVERITIES: RaidSeverity[] = ["high", "medium", "low"];
const CLOSED = new Set(["done", "closed", "cancelled", "resolved", "accepted"]);

export function summariseRaid(items: readonly RaidItem[]): RaidSummary {
  const byType: Record<string, number> = { risk: 0, assumption: 0, issue: 0, dependency: 0, other: 0 };
  const bySeverity: Record<string, number> = { high: 0, medium: 0, low: 0, other: 0 };
  let openItems = 0;
  for (const it of items) {
    const t = String(it.type ?? "").toLowerCase();
    byType[TYPES.includes(t as RaidType) ? t : "other"]! += 1;
    const sev = String(it.severity ?? "").toLowerCase();
    bySeverity[SEVERITIES.includes(sev as RaidSeverity) ? sev : "other"]! += 1;
    if (!CLOSED.has(String(it.status ?? "").toLowerCase())) openItems += 1;
  }
  return {
    total: items.length,
    byType: byType as RaidSummary["byType"],
    bySeverity: bySeverity as RaidSummary["bySeverity"],
    openItems,
  };
}
