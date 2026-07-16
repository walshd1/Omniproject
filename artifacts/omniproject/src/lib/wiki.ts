import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { DocBlock } from "@workspace/backend-catalogue";

/**
 * Wiki / collaborative-docs client hooks over `/api/wiki/*` (roadmap 2.1). Documents are built of primitive
 * blocks (see backend-catalogue) and stored in the backend through the broker seam; these hooks read/write
 * them. Live collaboration reuses the existing seams — presence room `doc:<id>` and the comments thread
 * keyed `doc:<id>` — so a document gets co-presence, soft-locks and @mention threads exactly like an issue.
 */

export interface WikiSpace { id: string; key: string; name: string; description?: string | null }
export interface WikiDocSummary { id: string; spaceId: string; parentId?: string | null; slug: string; title: string; updatedAt: string; updatedBy?: string | null }
export interface WikiBacklink { id: string; title: string; slug: string; spaceId: string }
export interface WikiDoc extends WikiDocSummary { blocks: DocBlock[]; backlinks?: WikiBacklink[] }
export interface WikiDocInput { spaceId: string; title: string; blocks: DocBlock[]; parentId?: string | null; slug?: string }

/** The shared-surface room id a document uses for presence + comments (matches the server convention). */
export const wikiRoomId = (docId: string) => `doc:${docId}`;

export const wikiSpacesKey = ["wiki", "spaces"] as const;
export const wikiDocsKey = (spaceId?: string) => ["wiki", "docs", spaceId ?? "all"] as const;
export const wikiDocKey = (id: string) => ["wiki", "doc", id] as const;

/** The knowledge-base spaces. */
export function useWikiSpaces() {
  return useQuery({ queryKey: wikiSpacesKey, queryFn: () => getJson<WikiSpace[]>("/api/wiki/spaces"), staleTime: 30_000 });
}

/** The documents in a space (block bodies omitted — a listing), or all documents when no space given. */
export function useWikiDocs(spaceId?: string) {
  const qs = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : "";
  return useQuery({ queryKey: wikiDocsKey(spaceId), queryFn: () => getJson<WikiDocSummary[]>(`/api/wiki/docs${qs}`), staleTime: 15_000 });
}

/** One document with its blocks + server-resolved backlinks. */
export function useWikiDoc(id: string | undefined) {
  return useQuery({
    queryKey: wikiDocKey(id ?? ""),
    queryFn: () => getJson<WikiDoc>(`/api/wiki/docs/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

/** Create a document (contributor+ server-side). */
export function useCreateWikiDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WikiDocInput) => sendJson<WikiDoc>("/api/wiki/docs", input, "POST", "Failed to create document"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki"] }),
  });
}

/** Update a document (contributor+ server-side). */
export function useSaveWikiDoc(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WikiDocInput) => sendJson<WikiDoc>(`/api/wiki/docs/${encodeURIComponent(id)}`, input, "PUT", "Failed to save document"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: wikiDocKey(id) }); qc.invalidateQueries({ queryKey: ["wiki", "docs"] }); },
  });
}

/** Delete a document (manager+ server-side). */
export function useDeleteWikiDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson(`/api/wiki/docs/${encodeURIComponent(id)}`, undefined, "DELETE", "Failed to delete document"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki"] }),
  });
}
