import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";

/**
 * Saved-views client. A saved view is a named preset of columns + sort (+ filters/grouping) scoped
 * to a surface (e.g. "grid"). Views are SHARED, customer-level presentation config persisted to the
 * config bundle via /api/views — any authenticated user can save/switch, like team shared filters.
 */
export interface SavedView {
  id: string;
  name: string;
  scope?: string;
  columns?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  filters?: { field: string; value: string }[];
  groupBy?: string;
}

export const savedViewsQueryKey = ["saved-views"] as const;

export function useSavedViews() {
  return useQuery({
    queryKey: savedViewsQueryKey,
    queryFn: () => getJson<{ views: SavedView[] }>("/api/views").then((r) => r.views),
    staleTime: 30_000,
  });
}

/** Persist the full saved-views list (CSRF attached by the global fetch patch). */
export function useSaveViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (views: SavedView[]) => {
      const res = await fetch("/api/views", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views }),
      });
      if (!res.ok) throw responseError(res, await safeJson(res), "Failed to save views");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: savedViewsQueryKey });
    },
  });
}
