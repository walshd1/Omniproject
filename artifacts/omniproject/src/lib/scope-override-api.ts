import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client read/write for SCOPE OVERRIDES — a programme/project's own tightened ruleset and its allow-listed
 * settings overrides. Both are PMO/admin governance controls, gated server-side by the delegation policy.
 */

/** A target scope for an override — a programme or a project. */
export type OverrideScope = { kind: "programme"; id: string } | { kind: "project"; id: string };

const scopeQuery = (scope: OverrideScope): string =>
  scope.kind === "programme" ? `programmeId=${encodeURIComponent(scope.id)}` : `projectId=${encodeURIComponent(scope.id)}`;
const scopeBody = (scope: OverrideScope): Record<string, string> =>
  scope.kind === "programme" ? { programmeId: scope.id } : { projectId: scope.id };

// ── Ruleset (tighten-only) ────────────────────────────────────────────────────────────────────────────────
export type RuleMode = "off" | "warn" | "hard";
export interface RuleCatalogueEntry { id: string; label: string; description: string; mode: RuleMode; defaultMode: RuleMode }
export interface RulesetOverride { modes: Record<string, RuleMode>; fieldRules: Array<{ id: string; action: string; field: string; mode: RuleMode; whenPresent?: string; message?: string }> }

/** The org rule catalogue (each rule's base/effective mode) — the baseline a scope may tighten from. */
export function useRulesetCatalogue() {
  return useQuery({ queryKey: ["ruleset-catalogue"], queryFn: () => getJson<RuleCatalogueEntry[]>("/api/admin/ruleset"), staleTime: 30_000 });
}

export function useRulesetScopeOverride(scope: OverrideScope | null) {
  return useQuery({
    queryKey: ["ruleset-scope-override", scope?.kind, scope?.id],
    queryFn: () => getJson<{ scope: string; override: RulesetOverride }>(`/api/admin/ruleset/scope?${scopeQuery(scope!)}`),
    enabled: !!scope?.id,
    staleTime: 15_000,
  });
}

export function useSaveRulesetScopeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, override }: { scope: OverrideScope; override: RulesetOverride }) =>
      sendJson<{ scope: string; override: RulesetOverride }>("/api/admin/ruleset/scope", { ...scopeBody(scope), override }, "PUT", "Failed to save the ruleset override"),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ruleset-scope-override", v.scope.kind, v.scope.id] }),
  });
}

// ── Settings (allow-list override) ────────────────────────────────────────────────────────────────────────
export type SettingsOverride = Record<string, unknown>;

export function useSettingsScopeOverride(scope: OverrideScope | null) {
  return useQuery({
    queryKey: ["settings-scope-override", scope?.kind, scope?.id],
    queryFn: () => getJson<{ scope: string; override: SettingsOverride }>(`/api/settings/scope?${scopeQuery(scope!)}`),
    enabled: !!scope?.id,
    staleTime: 15_000,
  });
}

export function useSaveSettingsScopeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, patch }: { scope: OverrideScope; patch: Record<string, unknown> }) =>
      sendJson<{ scope: string; override: SettingsOverride; rejected: string[] }>("/api/settings/scope", { ...scopeBody(scope), patch }, "PUT", "Failed to save the settings override"),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["settings-scope-override", v.scope.kind, v.scope.id] }),
  });
}
