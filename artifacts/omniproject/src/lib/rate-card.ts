import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Rate-card client (read side). The server resolves rates in memory and returns only the aggregated
 * roll-up — a rate or a plaintext identity never reaches the browser. This drives the Staff Time &
 * Cost report; the PMO authoring screen has its own mutation hooks.
 */

/** One role's contribution to the roll-up (hashed title + label only — no rate is exposed). */
export interface StaffCostRow {
  titleHash: string;
  titleLabel: string;
  hours: number;
  /** True cost of this role's time. */
  cost: number;
  /** Billed to the customer (client-facing time only; 0 for internal-only roles). */
  charge: number;
}

/** A PMO-defined value column (e.g. "True cost", "Cost to customer") totalled across the project. */
export interface ColumnTotal {
  id: string;
  label: string;
  kind: "cost" | "charge";
  total: number;
}

/** The server-side staff time-and-cost roll-up for one project (aggregated; carries no rates). */
export interface StaffCost {
  internalCost: number;
  clientCost: number;
  totalCost: number;
  charge: number;
  margin: number;
  /** Hours that couldn't be costed — no title mapping or no rate for the role/type/facing. */
  unratedHours: number;
  byTitle: StaffCostRow[];
  /** The project's PMO-defined type (drives which rate column applies), or null if unset. */
  projectType: string | null;
  /** The PMO value columns totalled for this project (defaults to true cost + cost-to-customer). */
  columns: ColumnTotal[];
  /** Ids of the general cost rules that fired for this project (margin/overhead overrides applied). */
  appliedCostRules: string[];
}

/** React Query cache key for a project's staff time-and-cost roll-up. */
export const staffCostQueryKey = (projectId: string) => ["staff-cost", projectId] as const;

/** The aggregated staff time-and-cost roll-up for a project (PMO-gated server-side). */
export function useStaffCost(projectId: string) {
  return useQuery({
    queryKey: staffCostQueryKey(projectId),
    queryFn: () => getJson<StaffCost>(`/api/projects/${encodeURIComponent(projectId)}/staff-cost`),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
