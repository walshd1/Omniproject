import { create } from "zustand";

/**
 * Side-panel store (the "sidePanel" feature module). A single slide-over that any surface can open
 * for a work item — the grid, the board, search results — by id, without prop-drilling. Holds only
 * the target identity; the panel component fetches the issue + activity itself. UI-only state.
 */
export interface SidePanelState {
  open: boolean;
  projectId: string | null;
  issueId: string | null;
  /** Open the panel for a specific work item. */
  openIssue: (projectId: string, issueId: string) => void;
  /** Close the panel (keeps the last target so the close transition can animate). */
  close: () => void;
}

export const useSidePanel = create<SidePanelState>((set) => ({
  open: false,
  projectId: null,
  issueId: null,
  openIssue: (projectId, issueId) => set({ open: true, projectId, issueId }),
  close: () => set({ open: false }),
}));
