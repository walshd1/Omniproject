import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { useDefImporterEnabled, type DefBinding } from "./defs";

/**
 * Def SELECTION-BINDINGS client (roadmap X.12). A binding records which def is IN USE for a logical SLOT at a
 * scope, and whether it's LOCKED so lower scopes can't override ("the org mandates this methodology"). The
 * winner LOGIC lives server-side (see useActiveDefs / GET /defs/active); these hooks are for AUTHORING a
 * selection: read the per-scope maps and set/clear one. Behind the default-off `defImporter` module.
 */

/** One scope's slot→binding map (the shape of each field returned by GET /defs/bindings). */
export type ScopeBindings = Record<string, DefBinding>;
export interface BindingMaps { org: ScopeBindings; programme: ScopeBindings; project: ScopeBindings; user: ScopeBindings }
export type BindingScope = "user" | "project" | "programme" | "org";

export const bindingsKey = ["defs", "bindings"] as const;

/** The org + (the caller's) programme + project + user selection maps for the given scope context. */
export function useDefBindings(projectId?: string, programmeId?: string) {
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  if (programmeId) qs.set("programmeId", programmeId);
  const suffix = qs.toString();
  const enabled = useDefImporterEnabled();
  return useQuery({
    queryKey: [...bindingsKey, projectId ?? null, programmeId ?? null] as const,
    queryFn: () => getJson<BindingMaps>(`/api/defs/bindings${suffix ? `?${suffix}` : ""}`),
    enabled,
    staleTime: 15_000,
  });
}

export interface SetBindingInput {
  scope: BindingScope;
  slot: string;
  /** The def to select, or null to CLEAR the slot (reverting to the next scope in the chain). */
  defId?: string | null;
  /** Lock the choice so lower scopes can't override. Setting a lock needs a fresh step-up (server-enforced). */
  locked?: boolean;
  projectId?: string;
  programmeId?: string;
}

/** Set (or clear) one slot's selection at a scope. Invalidates the binding + active-winner caches on success. */
export function useSetBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetBindingInput) => sendJson<{ scope: string; bindings: ScopeBindings }>("/api/defs/bindings", input, "PUT"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: bindingsKey });
      qc.invalidateQueries({ queryKey: ["defs", "active"] });
    },
  });
}
