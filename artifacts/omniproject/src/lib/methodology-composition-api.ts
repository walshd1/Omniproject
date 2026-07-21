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
