import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { StyleSpec } from "./artifact-style";

/**
 * Saved-views client. A saved view is a named preset of columns + sort (+ filters/grouping) scoped
 * to a surface (e.g. "grid"). Views are SHARED, customer-level presentation config persisted to the
 * config bundle via /api/views — any authenticated user can save/switch, like team shared filters.
 */
export interface SavedView {
  id: string;
  name: string;
  scope?: string;
  /** Which entity this view is for (view-engine views); omitted for legacy grid views. */
  entity?: "task" | "issue";
  /** How the view engine renders it: list, board, table, timeline or chart. Omitted = list. */
  viewKind?: "list" | "board" | "table" | "timeline" | "chart";
  /** For `viewKind: "timeline"`: the date field whose month buckets the records. */
  dateField?: string;
  /** For `viewKind: "chart"`: how the chart draws the records. */
  chart?: { type: "bar" | "pie" | "donut" | "wbs" | "gantt"; groupField?: string; startField?: string; endField?: string };
  columns?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  filters?: { field: string; value: string }[];
  groupBy?: string;
  /** Optional presentation styling (title/font/colours/background) applied by ArtifactFrame at render. */
  style?: StyleSpec;
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
      return sendJson<unknown>("/api/views", { views }, "PUT", "Failed to save views");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: savedViewsQueryKey });
    },
  });
}
