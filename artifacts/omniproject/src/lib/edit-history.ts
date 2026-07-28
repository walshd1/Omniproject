import { create } from "zustand";

/**
 * A bounded, in-memory undo/redo stack for issue field edits — the multi-step counterpart to the
 * single-shot "Saved · Undo" toast. Every field write records an entry here (its before/after value);
 * undo walks back through them, redo forward. Purely client-side and ephemeral (nothing at rest), in
 * keeping with the app's stateless ethos: it's a session convenience, not a stored audit log (the
 * broker's activity feed is the real record). The actual re-application of an entry is concurrency-safe
 * and lives with the shared writer (see use-undo-redo) — this store only holds the two stacks.
 */
export interface EditEntry {
  projectId: string;
  issueId: string;
  field: string;
  /** Value before the edit — what an undo restores. */
  from: unknown;
  /** Value after the edit — what a redo re-applies. */
  to: unknown;
  /** Human label (e.g. "Status") for surfacing in the palette / menus. */
  label: string;
}

/** How many edits to remember — enough for a real session, bounded so the stack can't grow without limit. */
export const EDIT_HISTORY_CAP = 50;

interface EditHistoryState {
  past: EditEntry[];
  future: EditEntry[];
  /** Record a new edit: push onto `past` (capped) and drop any redo future (a fresh edit forks history). */
  record: (entry: EditEntry) => void;
  /** Pop the most recent past edit onto the future stack and return it (for the caller to inverse-apply). */
  popUndo: () => EditEntry | undefined;
  /** Pop the most recent future edit back onto the past stack and return it (for the caller to re-apply). */
  popRedo: () => EditEntry | undefined;
  clear: () => void;
}

export const useEditHistory = create<EditHistoryState>((set, get) => ({
  past: [],
  future: [],
  record: (entry) => set((s) => ({ past: [...s.past, entry].slice(-EDIT_HISTORY_CAP), future: [] })),
  popUndo: () => {
    const { past, future } = get();
    const entry = past[past.length - 1];
    if (!entry) return undefined;
    set({ past: past.slice(0, -1), future: [...future, entry] });
    return entry;
  },
  popRedo: () => {
    const { past, future } = get();
    const entry = future[future.length - 1];
    if (!entry) return undefined;
    set({ future: future.slice(0, -1), past: [...past, entry] });
    return entry;
  },
  clear: () => set({ past: [], future: [] }),
}));
