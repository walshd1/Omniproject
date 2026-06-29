import { create } from "zustand";

/**
 * Global-search engine + store (the "globalSearch" feature module). A fast, dependency-free
 * cross-entity quick-find over the existing read-model (projects / issues / programmes). The
 * ranking is pure and unit-tested; the overlay component feeds it the lists it already has cached.
 */

export type HitType = "project" | "issue" | "programme";

export interface SearchHit {
  type: HitType;
  id: string;
  label: string;
  sublabel?: string;
  /** For an issue, the project it lives in (used to route + open the side-panel). */
  projectId?: string;
}

/** The entity lists to search over — each optional so a caller can pass only what it has loaded. */
export interface SearchSources {
  projects?: { id: string; name: string }[];
  programmes?: { id: string; name: string }[];
  issues?: { id: string; title: string; projectId: string }[];
}

/** Score a candidate against a lowercased query: -1 = no match, else lower is better (0 = exact,
 *  1 = prefix, 2 = word-boundary, 3 = substring). Stable, so equal scores keep input order. */
export function scoreMatch(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return -1;
}

/**
 * Rank entities matching `query` across the provided sources. Empty/whitespace query → no hits.
 * Results are ordered by match quality then by type (projects, then issues, then programmes), and
 * capped at `limit`.
 */
export function searchEntities(query: string, sources: SearchSources, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const TYPE_ORDER: Record<HitType, number> = { project: 0, issue: 1, programme: 2 };
  const scored: { hit: SearchHit; score: number; order: number }[] = [];

  (sources.projects ?? []).forEach((p, i) => {
    const s = scoreMatch(p.name, q);
    if (s >= 0) scored.push({ hit: { type: "project", id: p.id, label: p.name }, score: s, order: i });
  });
  (sources.issues ?? []).forEach((it, i) => {
    const s = scoreMatch(it.title, q);
    if (s >= 0) scored.push({ hit: { type: "issue", id: it.id, label: it.title, projectId: it.projectId }, score: s, order: i });
  });
  (sources.programmes ?? []).forEach((pr, i) => {
    const s = scoreMatch(pr.name, q);
    if (s >= 0) scored.push({ hit: { type: "programme", id: pr.id, label: pr.name }, score: s, order: i });
  });

  scored.sort((a, b) =>
    a.score - b.score ||
    TYPE_ORDER[a.hit.type] - TYPE_ORDER[b.hit.type] ||
    a.order - b.order,
  );
  return scored.slice(0, limit).map((s) => s.hit);
}

export interface GlobalSearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useGlobalSearch = create<GlobalSearchState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
