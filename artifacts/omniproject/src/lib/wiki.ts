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

/** A document with its children resolved — the page-tree node the sidebar renders. */
export interface WikiDocNode extends WikiDocSummary { children: WikiDocNode[]; depth: number }

/**
 * Nest a flat doc list into a page tree by `parentId` (roadmap 2.1 — page tree). Pure and defensive:
 * a doc whose parent is missing, is itself, or would close a cycle degrades to a ROOT rather than
 * vanishing, so a corrupted/hostile parent link can never hide a page or loop the walk. Siblings are
 * ordered by title (then id) so the tree is stable across renders. `depth` is filled for indentation.
 */
export function buildDocTree(docs: readonly WikiDocSummary[]): WikiDocNode[] {
  const byId = new Map<string, WikiDocNode>(docs.map((d) => [d.id, { ...d, children: [], depth: 0 }]));
  const hasValidParent = (node: WikiDocNode): boolean => {
    const pid = node.parentId ?? null;
    if (!pid || pid === node.id || !byId.has(pid)) return false;
    // Walk ancestors: if we reach this node again (or any repeat), the link is cyclic → treat as root.
    const guard = new Set<string>();
    let cur: WikiDocNode | undefined = byId.get(pid);
    while (cur) {
      if (cur.id === node.id || guard.has(cur.id)) return false;
      guard.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return true;
  };
  const roots: WikiDocNode[] = [];
  for (const node of byId.values()) {
    if (hasValidParent(node)) byId.get(node.parentId!)!.children.push(node);
    else roots.push(node);
  }
  const order = (nodes: WikiDocNode[], depth: number) => {
    nodes.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    for (const n of nodes) { n.depth = depth; order(n.children, depth + 1); }
  };
  order(roots, 0);
  return roots;
}

/** Flatten a page tree to a depth-tagged list in display order (parent immediately before its children). */
export function flattenDocTree(nodes: readonly WikiDocNode[]): WikiDocNode[] {
  const out: WikiDocNode[] = [];
  const walk = (ns: readonly WikiDocNode[]) => { for (const n of ns) { out.push(n); walk(n.children); } };
  walk(nodes);
  return out;
}

/** The ids of every descendant of `id` in the flat doc list — the pages that can't be its parent (a doc
 *  may not nest under its own subtree). Used to keep the editor's parent picker cycle-free. */
export function descendantIds(docs: readonly WikiDocSummary[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const d of docs) {
    const pid = d.parentId ?? null;
    if (pid) { const arr = childrenOf.get(pid) ?? []; arr.push(d.id); childrenOf.set(pid, arr); }
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const c of childrenOf.get(stack.pop()!) ?? []) if (!out.has(c)) { out.add(c); stack.push(c); }
  }
  return out;
}

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
