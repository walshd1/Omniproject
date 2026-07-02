import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Content pages client — a named, flat, ordered list of unified-library component ids (reports +
 * widgets, see @workspace/backend-catalogue componentsFor("content")) a customer composes into
 * free-form content. Same shared-config shape as customReports: any authed user reads (so a saved
 * page renders for everyone); authoring is PMO-gated server-side. Never project data.
 */
export interface ContentPageDef {
  id: string;
  name: string;
  /** Library component ids, in display order (e.g. ["report:evm", "widget:portfolioHealth"]). */
  componentIds: string[];
}

export const contentPagesQueryKey = ["content-pages"] as const;

/** The saved content-page definitions. */
export function useContentPages() {
  return useQuery({
    queryKey: contentPagesQueryKey,
    queryFn: () => getJson<{ contentPages: ContentPageDef[] }>("/api/content-pages").then((r) => r.contentPages),
    staleTime: 30_000,
  });
}

/** Persist the full content-page list (pmo). */
export function useSaveContentPages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contentPages: ContentPageDef[]) => sendJson<{ contentPages: ContentPageDef[] }>("/api/content-pages", { contentPages }),
    onSuccess: (data) => qc.setQueryData(contentPagesQueryKey, data.contentPages),
  });
}
