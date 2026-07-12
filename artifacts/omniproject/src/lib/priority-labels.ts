import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Custom display names for the canonical priority levels (admin/PMO-set). `labelFor` maps a canonical
 * priority to its display label, falling back to the canonical name. Kept tiny so the priority
 * selectors/badges can show the org's own wording without threading state everywhere.
 */
export interface PriorityLabels { canonical: string[]; labels: Record<string, string> }

const KEY = ["priority-labels"] as const;

export function usePriorityLabels() {
  const { data } = useQuery({ queryKey: KEY, queryFn: () => getJson<PriorityLabels>("/api/priority-labels") });
  const labels = data?.labels ?? {};
  return {
    canonical: data?.canonical ?? ["none", "low", "medium", "high", "urgent"],
    labels,
    /** Display label for a canonical priority (falls back to the canonical name). */
    labelFor: (p: string | null | undefined): string => (p ? labels[p] ?? p : ""),
  };
}

export function useSavePriorityLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labels: Record<string, string>) => sendJson<PriorityLabels>("/api/priority-labels", { labels }, "PUT", "Could not save priority labels"),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
