import { create } from "zustand";
import type { SearchHit } from "./global-search";

/**
 * Recently-visited items — a findability aid that remembers the last handful of work items a person
 * opened (projects, programmes, issues) so they can jump straight back without retyping a search.
 *
 * Personal and ephemeral: it lives in localStorage only (keyed per browser), nothing is sent to the
 * server, and clearing it simply empties the "Recent" list — fully in keeping with OmniProject's
 * stateless, nothing-at-rest ethos. A recent entry is shaped exactly like a search hit, so the
 * global-search overlay can render and route to it through the same path it uses for live results.
 */

/** A visited entity. Same shape as a {@link SearchHit} so the search overlay can reuse its row + routing. */
export type RecentItem = SearchHit;

/** How many recents to keep — enough to be useful, small enough to stay scannable. */
export const RECENTS_CAP = 8;
const KEY = "omni:recents";

const keyOf = (i: RecentItem): string => `${i.type}:${i.id}`;

/**
 * Add a visit to the front of the list: de-duplicated by type+id (re-visiting moves it back to the
 * top with its latest label), newest first, capped at `cap`. Pure — returns a new array.
 */
export function addRecent(list: RecentItem[], item: RecentItem, cap = RECENTS_CAP): RecentItem[] {
  const k = keyOf(item);
  return [item, ...list.filter((i) => keyOf(i) !== k)].slice(0, cap);
}

/** Read recents from localStorage, tolerating anything unexpected (→ empty list, no impact). */
export function loadRecents(): RecentItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is RecentItem =>
        !!i && typeof i === "object" &&
        typeof (i as RecentItem).type === "string" &&
        typeof (i as RecentItem).id === "string" &&
        typeof (i as RecentItem).label === "string",
    ).slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

function saveRecents(list: RecentItem[]): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full/blocked — recents just won't persist */ }
}

export interface RecentItemsState {
  items: RecentItem[];
  /** Note that the user opened an item; moves it to the top and persists. */
  record: (item: RecentItem) => void;
  /** Forget all recents (e.g. a "clear" affordance). */
  clear: () => void;
}

export const useRecentItems = create<RecentItemsState>((set) => ({
  items: loadRecents(),
  record: (item) =>
    set((s) => {
      const items = addRecent(s.items, item);
      saveRecents(items);
      return { items };
    }),
  clear: () => { saveRecents([]); set({ items: [] }); },
}));
