/**
 * Tracks whether this browser session holds exploration work (captured
 * snapshots, what-if scenarios, dependency links) that has NOT been downloaded.
 *
 * The model the user asked for: when you change a snapshot to test a hypothesis,
 * it's staged in the volatile session — and you either DOWNLOAD it to keep it, or
 * it is discarded at session end (sessionStorage clears when the tab closes). This
 * tracker is the signal behind that affordance: it drives the "unsaved
 * exploration — download to keep" banner and the leave-the-page warning. It is a
 * dependency-free leaf (no imports) so the snapshot/dependency modules can mark
 * it without an import cycle.
 */

type Listener = () => void;

let dirty = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** True when there is undownloaded exploration work in this session. */
export function isExplorationDirty(): boolean {
  return dirty;
}

/** Mark that exploration work was created/changed (download-or-lose applies). */
export function markExplorationDirty(): void {
  if (!dirty) {
    dirty = true;
    emit();
  }
}

/** Mark the work as saved (the user downloaded a copy). */
export function markExplorationClean(): void {
  if (dirty) {
    dirty = false;
    emit();
  }
}

/** Subscribe to dirty-state changes; returns an unsubscribe fn. */
export function subscribeExploration(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
