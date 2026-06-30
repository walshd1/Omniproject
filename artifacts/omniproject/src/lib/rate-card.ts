import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/** Client-facing vs internal time — rates and charge differ by facing. */
export type Facing = "client" | "internal";

/** A PMO-defined value column on a project type (any number; default is true-cost + cost-to-customer). */
export interface ValueColumn {
  id: string;
  label: string;
  kind: "cost" | "charge";
  /** A charge column's own margin/overhead; absent fields fall back to the scope-resolved uplift. */
  uplift?: { margin?: number; overhead?: number };
}

/** A PMO-defined project type. Rates and the value model are keyed by type. */
export interface ProjectType {
  id: string;
  label: string;
  values?: ValueColumn[];
}

/** Margin + overhead as non-negative fractions (e.g. 0.2 = 20%). */
export interface Uplift {
  margin: number;
  overhead: number;
}

/** The full rate-card config as the PMO authoring screen reads/writes it. Rates are keyed by
 *  hashed job-title → project type → facing; a plaintext rate only ever lives here, behind the PMO gate. */
export interface RateCardConfig {
  /** hashed job-title → display label. */
  titles: Record<string, string>;
  /** hashed job-title → project type → facing → rate. */
  rates: Record<string, Record<string, Partial<Record<Facing, number>>>>;
  projectTypes: ProjectType[];
  uplift: { central: Uplift; programme: Record<string, Partial<Uplift>>; project: Record<string, Partial<Uplift>> };
}

export const rateCardQueryKey = ["rate-card"] as const;

/** The PMO rate-card config (titles, rates, project types + value columns, uplift). PMO-gated. */
export function useRateCard() {
  return useQuery({
    queryKey: rateCardQueryKey,
    queryFn: () => getJson<RateCardConfig>("/api/rate-card"),
    staleTime: 30_000,
  });
}

/** A role authored in plaintext: the server hashes the title (keyed HMAC) to key the card. */
export interface Role {
  title: string;
  /** projectType id → facing → rate. */
  rates: Record<string, Partial<Record<Facing, number>>>;
}

/** The body the rate-card PUT accepts. Roles may be authored in plaintext (`roles`, server hashes) or
 *  round-tripped as hashed `titles` + `rates`; `roles` wins when both are present. Central margin/
 *  overhead rides along as `uplift`. */
export interface RateCardSave {
  titles?: Record<string, string>;
  rates?: RateCardConfig["rates"];
  roles?: Role[];
  projectTypes: ProjectType[];
  uplift?: Partial<Uplift>;
}

/** Persist the rate card + project types + central uplift (PMO). Replaces the stored card, so the
 *  caller passes the full config back (edit-in-place screens round-trip the untouched parts). */
export function useSaveRateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RateCardSave) => sendJson<RateCardConfig>("/api/rate-card", body),
    onSuccess: (data) => {
      qc.setQueryData(rateCardQueryKey, data);
      qc.invalidateQueries({ queryKey: ["staff-cost"] });
    },
  });
}

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
