/**
 * One-generation undo buffer — the "snapshot before the first mutation in a batch, one-shot
 * restore" mechanism shared by every admin editor that offers an undo (the rate card, the AI
 * provider registry, the role map, …). A single logical request (e.g. one PUT) can call SEVERAL
 * setters synchronously; batching them into ONE undo point (the state before the FIRST of them)
 * means "undo" always undoes the whole logical edit, not just its last statement. Batching is
 * closed on a microtask, which always runs before the next request's handler, so separate
 * requests still get separate undo points with no explicit "begin transaction" call anywhere.
 */
export interface UndoBuffer {
  /** Call at the START of every mutating setter, before mutating. Snapshots once per
   *  synchronous batch (a no-op for the 2nd+ call within the same tick). */
  beginMutation(): void;
  /** Restore the most recent pre-batch snapshot. One-shot — a second call right after is a
   *  no-op. Returns false when there's nothing to undo. */
  rollback(): boolean;
  /** Whether a rollback is currently available (for the admin UI to show/hide the control). */
  canRollback(): boolean;
  /** Test-only: drop any pending snapshot/batch (does NOT call `restore`). */
  reset(): void;
}

/** @param snapshot captures the current state (called once per batch, before the first
 *  mutation) — return a copy if the caller mutates in place, or just the current reference if
 *  the caller only ever replaces it wholesale. @param restore re-applies a captured snapshot
 *  (including any persistence the caller needs). */
export function createUndoBuffer<T>(snapshot: () => T, restore: (previous: T) => void): UndoBuffer {
  let previous: T | null = null;
  let batchOpen = false;

  function beginMutation(): void {
    if (batchOpen) return;
    previous = snapshot();
    batchOpen = true;
    queueMicrotask(() => { batchOpen = false; });
  }

  function rollback(): boolean {
    if (previous === null) return false;
    const restoreValue = previous;
    previous = null;
    restore(restoreValue);
    return true;
  }

  function canRollback(): boolean {
    return previous !== null;
  }

  function reset(): void {
    previous = null;
    batchOpen = false;
  }

  return { beginMutation, rollback, canRollback, reset };
}
