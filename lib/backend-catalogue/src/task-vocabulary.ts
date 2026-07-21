/**
 * Canonical GTD TASK-STATUS vocabulary — the single source of truth for the next-action statuses
 * OmniProject knows about, their workflow class and their display order. Authored as JSON
 * (assets/task-vocabulary.json), validated + embedded by gen-task-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as the work-item (issue) vocabulary next to it.
 *
 * This is the TASK axis (David Allen's GTD next-actions), DISTINCT from the work-item/issue status axis
 * in ./work-vocabulary. It keeps GTD's richer FIVE workflow classes (actionable/waiting/deferred/done/
 * dropped) rather than collapsing onto the four issue lifecycle classes. It lives BELOW the seam because
 * BOTH planes read it: the gateway's broker/vocabulary re-exports the status list + workflow class (and
 * adds the native⇄canonical synonym/dialect behaviour, which stays above the seam), and the SPA derives
 * its GTD status order + labels from it — so the two can never drift on WHICH task statuses exist.
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { TASK_VOCABULARY_DATA } from "./task-vocabulary.generated";

/** The GTD workflow class a task status falls in — what the actionable/closed/done maths key off.
 *  actionable = doable now · waiting = delegated/blocked on someone · deferred = scheduled or someday ·
 *  done · dropped (decided not to do). KEPT at five classes — the GTD axis is NOT the issue axis. */
export type TaskStatusClass = "actionable" | "waiting" | "deferred" | "done" | "dropped";

/** One canonical GTD task-status token (with its workflow class + display order). */
export interface TaskVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** The workflow class this status binds to — the ONE internal invariant kept for the GTD maths. Every
   *  status (shipped OR a scope-added custom one) must declare it, so a custom status behaves exactly like
   *  the internal class it binds to. */
  class: TaskStatusClass;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this status belongs to ("*" = neutral / all). Absent ⇒ neutral. Lets each
   *  methodology carry its own normal GTD nomenclature (surfaced by {@link taskStatusesForMethodology}). */
  methodologies?: string[];
}

/** The canonical GTD task statuses (compile-time contract). The runtime list comes from the asset; a
 *  drift test asserts the two agree. */
export type CanonicalTaskStatus = "next" | "waiting" | "scheduled" | "someday" | "done" | "dropped";

const entries: TaskVocabEntry[] = [...TASK_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) GTD task statuses in workflow order (next → dropped). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_TASK_STATUS: readonly CanonicalTaskStatus[] = entries.map((e) => e.id as CanonicalTaskStatus);

/** Canonical task status → its workflow class. */
export const TASK_STATUS_CLASS: Record<CanonicalTaskStatus, TaskStatusClass> = Object.fromEntries(
  entries.map((e) => [e.id, e.class]),
) as Record<CanonicalTaskStatus, TaskStatusClass>;

/** Canonical task status → its display label. */
export const TASK_STATUS_LABEL: Record<CanonicalTaskStatus, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalTaskStatus, string>;

/** The full task vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function taskVocabulary(): TaskVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the task vocabulary: the statuses. This is BOTH the `values` seeded into
 *  the system `task-vocabulary` config def AND the base a scope resolver folds org/programme/project/user
 *  overrides onto — one source of truth for the shipped default. */
export interface ResolvedTaskStatus { id: string; label: string; labels?: Record<string, string>; order: number; class: TaskStatusClass; methodologies: string[]; color?: string }
export interface TaskVocabularyValues {
  statuses: ResolvedTaskStatus[];
}

/** Build the shipped-default {@link TaskVocabularyValues} from the canonical entries. */
export function taskVocabularyValues(): TaskVocabularyValues {
  return {
    statuses: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, class: e.class, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The task statuses that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones — a
 *  methodology's normal GTD nomenclature. Pass the shipped default or a resolved set. */
export function taskStatusesForMethodology(methodologyId: string, statuses: readonly ResolvedTaskStatus[] = taskVocabularyValues().statuses): ResolvedTaskStatus[] {
  return tokensForMethodology(methodologyId, statuses);
}
