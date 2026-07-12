import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { Composition } from "./methodology-composition";

/**
 * Client read/write for the methodology composition (settings.methodologyComposition). Read via
 * GET /api/settings (like the other shared-config reads); write via PATCH. `null` = uncurated.
 */
export const methodologyCompositionQueryKey = ["methodology-composition"] as const;

export function useMethodologyComposition() {
  return useQuery({
    queryKey: methodologyCompositionQueryKey,
    queryFn: () => getJson<{ methodologyComposition?: Composition }>("/api/settings").then((s) => s.methodologyComposition ?? null),
    staleTime: 30_000,
  });
}

export function useSaveMethodologyComposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (methodologyComposition: Composition) =>
      sendJson("/api/settings", { methodologyComposition }, "PATCH", "Failed to save the methodology composition"),
    onSuccess: () => qc.invalidateQueries({ queryKey: methodologyCompositionQueryKey }),
  });
}
