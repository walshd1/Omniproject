/**
 * Canonical TASK-STATUS vocabulary — the single source of truth for the next-action statuses OmniProject
 * knows about, their workflow class and their display order. This is METHODOLOGY-AGNOSTIC infrastructure:
 * the code doesn't know about any one methodology. The vocabulary is DERIVED from the methodology
 * definitions (assets/methodologies/<id>.json → `tools.taskStatuses`), not a standalone asset — a task axis
 * is a methodology's OWN next-action nomenclature, so it's authored WHERE the methodology is, and ANY
 * methodology can declare one (GTD is the one that ships a task axis today; another could add its own with
 * no code change). The methodology JSON is validated + drift-guarded by gen-methodologies in CI, so this
 * stays data-not-code and can never drift from the methodology that owns it.
 *
 * This is the TASK axis (next-actions — GTD's exemplar), DISTINCT from the work-item/issue status axis in
 * ./work-vocabulary. It carries a richer FIVE workflow classes (actionable/waiting/deferred/done/dropped)
 * rather than collapsing onto the four issue lifecycle classes — the class set is the fixed internal
 * invariant every declared status (from any methodology) binds to, so the actionable/closed/done maths are
 * universal. It lives BELOW the seam because BOTH planes read it: the gateway's broker/vocabulary re-exports
 * the status list + workflow class (and adds the native⇄canonical synonym/dialect behaviour, which stays
 * above the seam), and the SPA derives its status order + labels from it — so the two can never drift on
 * WHICH task statuses exist. A methodology DEPLOY lands that methodology's own task statuses via the deploy
 * nomenclature (see methodology-deploy.ts).
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { METHODOLOGIES_DATA } from "./methodologies.generated";

/** The workflow class a task status falls in — what the actionable/closed/done maths key off.
 *  actionable = doable now · waiting = delegated/blocked on someone · deferred = scheduled or someday ·
 *  done · dropped (decided not to do). The fixed FIVE-class taxonomy every methodology's task statuses bind
 *  to (GTD's exemplar) — the next-action axis, NOT the issue axis. */
export type TaskStatusClass = "actionable" | "waiting" | "deferred" | "done" | "dropped";

/** One canonical task-status token (with its workflow class + display order). A methodology declares these
 *  under `tools.taskStatuses`; the shape is methodology-agnostic. */
export interface TaskVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** The workflow class this status binds to — the ONE internal invariant kept for the next-action maths.
   *  Every status (shipped OR a scope-added custom one) must declare it, so a custom status behaves exactly
   *  like the internal class it binds to. */
  class: TaskStatusClass;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this status belongs to ("*" = neutral / all). Absent ⇒ neutral. Lets each
   *  methodology carry its own next-action nomenclature (surfaced by {@link taskStatusesForMethodology}). */
  methodologies?: string[];
}

/** The concrete task-status ids the shipped methodologies declare (compile-time contract — GTD's set today).
 *  The runtime list is derived from the methodology definitions; a drift test asserts the two agree. */
export type CanonicalTaskStatus = "next" | "waiting" | "scheduled" | "someday" | "done" | "dropped";

/** The canonical task vocabulary, DERIVED from every methodology's declared `tools.taskStatuses` (deduped by
 *  id — first declarer wins), sorted by order. Today only GTD declares a task axis, so this is GTD's set; a
 *  future methodology that ships its own next-action statuses widens it as data, no code change. */
const entries: TaskVocabEntry[] = (() => {
  const out: TaskVocabEntry[] = [];
  const seen = new Set<string>();
  for (const m of METHODOLOGIES_DATA) {
    for (const s of m.tools.taskStatuses ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out.sort((a, b) => a.order - b.order);
})();

/** Canonical (internal) task statuses in workflow order (next → dropped). Derived from the methodology
 *  definitions, so a drift test can assert the set never silently changes. */
export const CANONICAL_TASK_STATUS: readonly CanonicalTaskStatus[] = entries.map((e) => e.id as CanonicalTaskStatus);

/** Canonical task status → its workflow class. */
export const TASK_STATUS_CLASS: Record<CanonicalTaskStatus, TaskStatusClass> = Object.fromEntries(
  entries.map((e) => [e.id, e.class]),
) as Record<CanonicalTaskStatus, TaskStatusClass>;

/** Canonical task status → its display label. */
export const TASK_STATUS_LABEL: Record<CanonicalTaskStatus, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalTaskStatus, string>;

/** The workflow class of ANY task status id, via its shipped binding (unknown ⇒ null). The ONE place the
 *  task-status → class meaning is derived, so no consumer re-hardcodes it (data/code split). */
export function taskStatusClassOf(id: string | null | undefined): TaskStatusClass | null {
  if (!id) return null;
  return TASK_STATUS_CLASS[id as CanonicalTaskStatus] ?? null;
}

/** True when a task status is CLOSED — its class is `done` or `dropped`. The completion test, class-backed. */
export function isTaskStatusClosed(id: string | null | undefined): boolean {
  const c = taskStatusClassOf(id);
  return c === "done" || c === "dropped";
}

/** True when a task status is specifically DONE (not merely dropped). */
export function isTaskStatusDone(id: string | null | undefined): boolean {
  return taskStatusClassOf(id) === "done";
}

/** The canonical task statuses that count as CLOSED — derived from the class binding, never hand-listed. */
export const TASK_CLOSED_STATUSES: readonly string[] = CANONICAL_TASK_STATUS.filter((id) => isTaskStatusClosed(id));

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
