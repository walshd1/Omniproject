import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { Composition } from "./methodology-composition";

/**
 * Client read/write for the methodology composition. It's held in the composition model as a nullable
 * `methodology-composition` config def (not a settings key), exposed at `/api/methodology-composition`.
 * `null` = uncurated (everything visible).
 */
export const methodologyCompositionKey = ["methodology-composition"] as const;

/** Returns `{ data }` (Composition | null) — matching the old settings-slice shape callers destructure. */
export function useMethodologyComposition(): { data: Composition } {
  const { data } = useQuery({
    queryKey: methodologyCompositionKey,
    queryFn: () => getJson<{ methodologyComposition: Composition }>("/api/methodology-composition"),
    staleTime: 15_000,
  });
  return { data: data?.methodologyComposition ?? null };
}

export function useSaveMethodologyComposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (methodologyComposition: Composition) =>
      sendJson("/api/methodology-composition", { methodologyComposition }, "PUT", "Failed to save the methodology composition"),
    onSuccess: () => qc.invalidateQueries({ queryKey: methodologyCompositionKey }),
  });
}

/** One methodology's one-click deploy PLAN — what turning it on lands (screens/ruleset/invariants/settings/
 *  nomenclature). Mirrors the backend {@link MethodologyDeployment}. */
export interface MethodologyDeploymentPlan {
  methodologyId: string;
  label: string;
  compositionItemIds: string[];
  ruleset: { id: string } | null;
  invariants: Array<{ id: string; message: string; severity?: "error" | "warn" }>;
  nomenclature: {
    states: string[];
    ceremonies: string[];
    statuses: Array<{ id: string; label: string }>;
    priorities: Array<{ id: string; label: string }>;
  };
  settings: Record<string, unknown>;
  summary: { views: number; reports: number; screens: number; invariants: number; hasRuleset: boolean; settings: number };
}

/** The scope a deploy targets — org (default), or a nearer programme/project. */
export type DeployScope = { programmeId?: string; projectId?: string };

/** PREVIEW the plan for a methodology id (any authed user). `enabled` gates the fetch. */
export function useMethodologyDeploymentPreview(methodologyId: string | null) {
  return useQuery({
    queryKey: ["methodology-deployment", methodologyId],
    queryFn: () => getJson<MethodologyDeploymentPlan>(`/api/methodology-composition/deployment/${encodeURIComponent(methodologyId!)}`),
    enabled: !!methodologyId,
    staleTime: 60_000,
  });
}

/** DEPLOY a methodology in one click (admin/PMO) — sets the composition + applies ruleset/settings at the scope. */
export function useDeployMethodology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ methodologyId, scope }: { methodologyId: string; scope?: DeployScope }) =>
      sendJson<{ appliedRuleset: string | null; appliedSettings: string[] }>(
        `/api/methodology-composition/deploy/${encodeURIComponent(methodologyId)}`,
        scope ?? {}, "POST", "Failed to deploy the methodology",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: methodologyCompositionKey }),
  });
}
