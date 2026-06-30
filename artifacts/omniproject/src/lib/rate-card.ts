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

// ── Conditional rules (the PMO "when → effect" plane) ────────────────────────────

/** Predicate comparison operators (mirrors the server's predicate engine). */
export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "truthy" | "falsy" | "negative" | "nonNegative";

/** Unary operators ignore `value`. */
export const UNARY_OPS: Op[] = ["truthy", "falsy", "negative", "nonNegative"];
/** Array operators take a list `value`. */
export const ARRAY_OPS: Op[] = ["in", "nin"];
export const ALL_OPS: Op[] = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "truthy", "falsy", "negative", "nonNegative"];

/** One condition: a context field compared to a value (value omitted for unary ops). */
export interface Predicate {
  field: string;
  op: Op;
  value?: unknown;
}

/** A rule's `when`: all-of `all` AND any-of `any` (empty ⇒ always matches). The editor uses `all`. */
export interface ConditionSet {
  all?: Predicate[];
  any?: Predicate[];
}

/** A general cost rule: when its predicate matches, override the margin / overhead. */
export interface CostRule {
  id: string;
  label?: string;
  when?: ConditionSet;
  effect: { margin?: number; overhead?: number };
}

export const costRulesQueryKey = ["rate-card", "cost-rules"] as const;

/** The PMO's general cost rules (predicate → margin/overhead override). PMO-gated. */
export function useCostRules() {
  return useQuery({
    queryKey: costRulesQueryKey,
    queryFn: () => getJson<{ costRules: CostRule[] }>("/api/rate-card/cost-rules").then((r) => r.costRules),
    staleTime: 30_000,
  });
}

/** Persist the cost-rule set (PMO). Invalidates the rules + staff-cost (rules change resolved uplift). */
export function useSaveCostRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (costRules: CostRule[]) => sendJson<{ costRules: CostRule[] }>("/api/rate-card/cost-rules", { costRules }),
    onSuccess: (data) => {
      qc.setQueryData(costRulesQueryKey, data.costRules);
      qc.invalidateQueries({ queryKey: ["staff-cost"] });
    },
  });
}

/** The hashed identity→role map: assignee-hash → title-hash, by scope. Names are irreversibly hashed —
 *  only the per-scope assignment *count* is meaningful client-side. */
export interface IdentityMap {
  central: Record<string, string>;
  programme: Record<string, Record<string, string>>;
  project: Record<string, Record<string, string>>;
}

export const identitiesQueryKey = ["rate-card", "identities"] as const;

/** The hashed identity→role map (hashes only; no plaintext assignee ever leaves the store). PMO-gated. */
export function useIdentities() {
  return useQuery({
    queryKey: identitiesQueryKey,
    queryFn: () => getJson<IdentityMap>("/api/rate-card/identities"),
    staleTime: 30_000,
  });
}

/** One assignment to write: a plaintext assignee (hashed server-side) → a role's title hash
 *  (empty `titleHash` clears the assignment). */
export interface IdentityAssignment {
  assignee: string;
  titleHash: string;
}

/** Write identity→role assignments for a scope (PMO). The assignee is hashed server-side, so the
 *  plaintext name is never persisted; re-sending the same name updates or (with empty title) clears it. */
export function useSaveIdentities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { level: "central" | "programme" | "project"; scopeId?: string; assignments: IdentityAssignment[] }) =>
      sendJson<{ ok: boolean }>("/api/rate-card/identities", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: identitiesQueryKey });
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
