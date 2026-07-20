import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { ConditionSet } from "./rate-card";

/**
 * Feature-module client. The gateway resolves the org → programme → project gating model and PMO
 * governance (mandate/forbid); this drives the admin/PMO/PM panels and lets the SPA lazily gate
 * optional UI for a scope.
 */
export type GateLevel = "org" | "programme" | "project";

/** The catalogue item kind: a toggleable module, a report surface, a methodology, or a self-host domain. */
export type GovernanceKind = "module" | "report" | "methodology" | "selfhost";

export interface FeatureStatus {
  id: string;
  /** Which catalogue plane this item lives in (modules vs reports vs methodologies). */
  kind: GovernanceKind;
  label: string;
  description: string;
  enabled: boolean;
  /** Loaded + mounted this process (was enabled at startup). */
  loaded: boolean;
  /** Enabled now but not loaded — needs a restart to take effect. */
  needsRestart: boolean;
  /** OFF for everyone until the org opts in (a safety/cost/storage call). */
  defaultOff?: boolean;
  reason?: "safety" | "cost" | "storage";
  /** A hard governance mandate locked this state — descendants can't change it. */
  locked?: boolean;
  lockedBy?: GateLevel;
  policy?: "require" | "forbid";
  /** When disabled, the level that turned it off. */
  blockedAt?: GateLevel;
}

/** A resolution scope: a project (and/or its programme). Omit for org-level. */
export interface FeatureScope {
  programmeId?: string | null;
  projectId?: string | null;
}

/** A scope's policy lists (disable/require/forbid) for the governance PUTs. */
export interface ScopeFeatureConfig {
  disabled: string[];
  required: string[];
  forbidden: string[];
}

export const featuresQueryKey = (scope: FeatureScope = {}) =>
  ["features", scope.programmeId ?? null, scope.projectId ?? null] as const;

function scopeQuery(scope: FeatureScope): string {
  const p = new URLSearchParams();
  if (scope.programmeId) p.set("programmeId", scope.programmeId);
  if (scope.projectId) p.set("projectId", scope.projectId);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The status of every optional feature module, resolved for a scope (org by default). */
export function useFeatures(scope: FeatureScope = {}) {
  return useQuery({
    queryKey: featuresQueryKey(scope),
    // Coalesce a missing/empty `features` field to `[]` so the queryFn never resolves to `undefined`
    // (react-query treats an undefined result as an invariant violation). `featureEnabled([], id)`
    // still returns true — the fail-open default — so gating behaviour is unchanged.
    queryFn: () => getJson<{ features: FeatureStatus[] }>(`/api/features${scopeQuery(scope)}`).then((r) => r.features ?? []),
    staleTime: 30_000,
  });
}

/** True when a feature module is enabled (for lazily gating optional UI). Defaults to true while the
 *  list is still loading / for an unknown id, so core UI never flickers off (the gateway is the real
 *  gate on the data behind each module). A resolved item under a hard governance FORBID is never
 *  enabled — checked explicitly so a forbidden surface can't slip through even if `enabled` drifts. */
export function featureEnabled(features: FeatureStatus[] | undefined, id: string): boolean {
  const f = features?.find((x) => x.id === id);
  if (!f) return true;
  if (f.policy === "forbid") return false;
  return f.enabled;
}

export const scopeFeatureMapsQueryKey = ["scope-feature-maps"] as const;

/**
 * The RAW per-scope override maps for every programme/project (not just one scope's resolved status) —
 * what the bulk CSV export/import round-trips. Read via `GET /api/settings` (open to any authenticated
 * session; webhook secrets are the only thing it redacts, which don't apply here) rather than the
 * generated `Settings` client type, which only models the subset of settings the setup wizard needs.
 */
export function useScopeFeatureMaps() {
  return useQuery({
    queryKey: scopeFeatureMapsQueryKey,
    queryFn: () =>
      getJson<{ programmeFeatures?: Record<string, ScopeFeatureConfig>; projectFeatures?: Record<string, ScopeFeatureConfig> }>("/api/settings").then((s) => ({
        programmeFeatures: s.programmeFeatures ?? {},
        projectFeatures: s.projectFeatures ?? {},
      })),
    staleTime: 30_000,
  });
}

/** Persist the org opt-out set (admin). CSRF is attached by the global fetch patch (lib/csrf).
 *  Settings mutations PATCH `/api/settings`; scope-feature mutations PUT `/api/features/*`. */
export function useSetDisabledFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disabledFeatures: string[]) => sendJson("/api/settings", { disabledFeatures }, "PATCH", "Failed to update feature modules"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/** Persist the org-level gating + governance (admin): default-off opt-ins + must-use/must-not-use. */
export function useSetOrgGovernance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { disabledFeatures?: string[]; enabledFeatures?: string[]; featureGovernance?: { required: string[]; forbidden: string[] } }) =>
      sendJson("/api/settings", patch, "PATCH", "Failed to update org feature governance"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/** Persist a programme's feature policy (pmo). Bounded server-side by the org-approved set. */
export function useSetProgrammeFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programmeId, config }: { programmeId: string; config: ScopeFeatureConfig }) =>
      sendJson(`/api/features/programme/${encodeURIComponent(programmeId)}`, config, "PUT", "Failed to update programme features"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["features"] }); qc.invalidateQueries({ queryKey: scopeFeatureMapsQueryKey }); },
  });
}

/** Persist a project's feature policy (manager). Bounded server-side by the programme/org grant. */
export function useSetProjectFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, programmeId, config }: { projectId: string; programmeId?: string | null; config: ScopeFeatureConfig }) =>
      sendJson(`/api/features/project/${encodeURIComponent(projectId)}${programmeId ? `?programmeId=${encodeURIComponent(programmeId)}` : ""}`, config, "PUT", "Failed to update project features"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["features"] }); qc.invalidateQueries({ queryKey: scopeFeatureMapsQueryKey }); },
  });
}

/**
 * A conditional governance rule (PMO): when its predicate matches a scope, mandate/forbid/disable
 * catalogue items. Predicate fields are restricted server-side to the synchronously-evaluable facts
 * (programmeId/projectId/projectType) so a rule resolves the same when read and when enforced.
 */
export interface GovernanceRule {
  id: string;
  label?: string;
  when?: ConditionSet;
  require?: string[];
  forbid?: string[];
  disable?: string[];
}

/** The fields a governance predicate may reference (mirrors the server's GOVERNANCE_RULE_FIELDS). */
export const GOVERNANCE_RULE_FIELDS = ["programmeId", "projectId", "projectType"];

export const governanceRulesQueryKey = ["governance-rules"] as const;

/** The PMO's conditional governance rules (predicate → require/forbid/disable). PMO-gated. */
export function useGovernanceRules() {
  return useQuery({
    queryKey: governanceRulesQueryKey,
    queryFn: () => getJson<{ governanceRules: GovernanceRule[] }>("/api/features/governance-rules").then((r) => r.governanceRules),
    staleTime: 30_000,
  });
}

/** Persist the governance-rule set (pmo). Invalidates the rules + the resolved feature status. */
export function useSaveGovernanceRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (governanceRules: GovernanceRule[]) => sendJson("/api/features/governance-rules", { governanceRules }, "PUT", "Failed to update governance rules"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: governanceRulesQueryKey });
      qc.invalidateQueries({ queryKey: ["features"] });
    },
  });
}
