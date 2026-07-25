import { create } from "zustand";
import { safeParseJson } from "./safe-json";
import { cleanTagPrefs, type TagPrefs } from "./tag-prefs";

/**
 * Per-user tag preferences store — the personal COLOUR + HIERARCHY overlay for tags. Like recents and
 * a11y prefs, it lives in localStorage only (keyed per browser); nothing is sent to the server, and
 * clearing it reverts every tag to its derived default colour and a flat list. The pure resolution
 * logic (default colour, ancestor path, sanitiser) lives in `tag-prefs`; this just persists the map.
 */

const KEY = "omni:tag-prefs";

/** Read the tag-prefs map from localStorage, sanitising whatever is there (→ {} on anything odd). */
export function loadTagPrefs(): TagPrefs {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanTagPrefs(safeParseJson(raw)) : {};
  } catch {
    return {};
  }
}

function saveTagPrefs(prefs: TagPrefs): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage full/blocked — prefs just won't persist */ }
}

/** A patch onto one tag's pref — a field set to `undefined`/"" CLEARS that facet (colour or parent). */
export type TagPrefPatch = { color?: string | undefined; parent?: string | undefined };

export interface TagPrefsState {
  prefs: TagPrefs;
  /** Merge a patch onto one tag's pref; an empty resulting pref removes the entry entirely. Re-sanitised. */
  setTag: (tag: string, patch: TagPrefPatch) => void;
  /** Forget one tag's overrides (revert it to default colour + top-level). */
  clearTag: (tag: string) => void;
  /** Forget every tag override. */
  reset: () => void;
}

export const useTagPrefs = create<TagPrefsState>((set) => ({
  prefs: loadTagPrefs(),
  setTag: (tag, patch) =>
    set((s) => {
      // Merge into a loose object; `undefined`/empty fields simply won't survive cleanTagPrefs,
      // which is what clears a facet. An all-empty pref drops the tag entirely.
      const merged: Record<string, unknown> = { ...s.prefs[tag], ...patch };
      const next = cleanTagPrefs({ ...s.prefs, [tag]: merged });
      saveTagPrefs(next);
      return { prefs: next };
    }),
  clearTag: (tag) =>
    set((s) => {
      const next = { ...s.prefs };
      delete next[tag];
      saveTagPrefs(next);
      return { prefs: next };
    }),
  reset: () => { saveTagPrefs({}); set({ prefs: {} }); },
}));
