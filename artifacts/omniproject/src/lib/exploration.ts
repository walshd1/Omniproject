/**
 * Tracks whether this browser session holds exploration work (captured
 * snapshots, what-if scenarios, dependency links, replica-workbench overlays)
 * that has NOT been downloaded.
 *
 * The model the user asked for: when you change a snapshot to test a hypothesis,
 * it's staged in the volatile session — and you either DOWNLOAD it to keep it, or
 * it is discarded at session end (sessionStorage clears when the tab closes). This
 * tracker is the signal behind that affordance: it drives the "unsaved
 * exploration — download to keep" banner and the leave-the-page warning. It is a
 * dependency-free leaf (no imports) so the snapshot/dependency modules can mark
 * it without an import cycle.
 *
 * PER-SOURCE (data-loss fix): the session accumulates unsaved work from SEVERAL
 * independent sources (captured snapshots, dependency edges, the replica-workbench
 * overlay, schedule-shift what-ifs). Each is downloaded — or lost — separately, so
 * the dirty state is tracked PER SOURCE. Downloading ONE source clears only its own
 * flag; the aggregate stays dirty (and the leave-warning stays up) while any OTHER
 * source is still unsaved. Previously a single global flag meant downloading one
 * artifact (e.g. snapshots) cleared the warning for all of them, so the untouched
 * sources (e.g. the replica overlay) were silently lost when the tab closed.
 */

/** An independent source of unsaved exploration work — each downloaded/discarded on its own. */
export type ExplorationSource = "snapshots" | "edges" | "replica" | "shifts";

type Listener = () => void;

const dirtySources = new Set<ExplorationSource>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** True when ANY source holds undownloaded exploration work in this session. */
export function isExplorationDirty(): boolean {
  return dirtySources.size > 0;
}

/** The sources with unsaved work (for a granular "you still have unsaved X" hint). */
export function explorationDirtySources(): ExplorationSource[] {
  return [...dirtySources];
}

/** Mark that a source created/changed work (download-or-lose applies to THAT source). */
export function markExplorationDirty(source: ExplorationSource): void {
  if (!dirtySources.has(source)) {
    dirtySources.add(source);
    emit();
  }
}

/**
 * Mark work as saved. Pass the SOURCE that was just downloaded to clear only its flag (the safe default — the
 * warning stays up for any other still-unsaved source). Pass no argument to clear EVERYTHING (a full
 * discard/reset — e.g. session teardown or a "discard all" action), which is the only way the old global
 * behaviour is still reachable, and never from a single-artifact download.
 */
export function markExplorationClean(source?: ExplorationSource): void {
  if (source === undefined) {
    if (dirtySources.size) {
      dirtySources.clear();
      emit();
    }
    return;
  }
  if (dirtySources.delete(source)) emit();
}

/** Subscribe to dirty-state changes; returns an unsubscribe fn. */
export function subscribeExploration(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
