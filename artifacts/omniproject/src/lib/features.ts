import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";

/**
 * Feature-module client. The gateway resolves the org → programme → project gating model and PMO
 * governance (mandate/forbid); this drives the admin/PMO/PM panels and lets the SPA lazily gate
 * optional UI for a scope.
 */
export type GateLevel = "org" | "programme" | "project";

export interface FeatureStatus {
  id: string;
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
    queryFn: () => getJson<{ features: FeatureStatus[] }>(`/api/features${scopeQuery(scope)}`).then((r) => r.features),
    staleTime: 30_000,
  });
}

/** True when a feature module is enabled (for lazily gating optional UI). Defaults to true while
 *  the list is still loading, so core UI never flickers off. */
export function featureEnabled(features: FeatureStatus[] | undefined, id: string): boolean {
  const f = features?.find((x) => x.id === id);
  return f ? f.enabled : true;
}

async function patchJson(url: string, body: unknown, errMsg: string): Promise<unknown> {
  const res = await fetch(url, {
    method: url.includes("/features/") ? "PUT" : "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), errMsg);
  return res.json();
}

/** Persist the org opt-out set (admin). CSRF is attached by the global fetch patch (lib/csrf). */
export function useSetDisabledFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disabledFeatures: string[]) => patchJson("/api/settings", { disabledFeatures }, "Failed to update feature modules"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/** Persist the org-level gating + governance (admin): default-off opt-ins + must-use/must-not-use. */
export function useSetOrgGovernance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { disabledFeatures?: string[]; enabledFeatures?: string[]; featureGovernance?: { required: string[]; forbidden: string[] } }) =>
      patchJson("/api/settings", patch, "Failed to update org feature governance"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/** Persist a programme's feature policy (pmo). Bounded server-side by the org-approved set. */
export function useSetProgrammeFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programmeId, config }: { programmeId: string; config: ScopeFeatureConfig }) =>
      patchJson(`/api/features/programme/${encodeURIComponent(programmeId)}`, config, "Failed to update programme features"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/** Persist a project's feature policy (manager). Bounded server-side by the programme/org grant. */
export function useSetProjectFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, programmeId, config }: { projectId: string; programmeId?: string | null; config: ScopeFeatureConfig }) =>
      patchJson(`/api/features/project/${encodeURIComponent(projectId)}${programmeId ? `?programmeId=${encodeURIComponent(programmeId)}` : ""}`, config, "Failed to update project features"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}
