/**
 * Canonical WORK-ITEM vocabulary — the single source of truth for the statuses and priorities
 * OmniProject knows about, their lifecycle class and their display order. Authored as JSON
 * (assets/work-vocabulary.json), validated + embedded by gen-work-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as fields, views and vendors.
 *
 * It lives BELOW the seam with the other canonical vocabularies because BOTH planes read it: the
 * gateway's broker/vocabulary re-exports the status list + lifecycle class (and adds the native⇄canonical
 * synonym/dialect behaviour, which stays above the seam), and the SPA derives its status/priority order
 * and labels from it — so the two can never drift on WHICH statuses/priorities exist.
 */
import { WORK_VOCABULARY_DATA } from "./work-vocabulary.generated";

/** The lifecycle class a status falls in — what the completion maths key off. */
export type StatusClass = "open" | "active" | "done" | "cancelled";

/** One canonical vocabulary token — a status (with a lifecycle class) or a priority. */
export interface WorkVocabEntry {
  kind: "status" | "priority";
  id: string;
  label: string;
  order: number;
  lifecycle?: StatusClass;
}

/** The canonical work-item statuses (compile-time contract). The runtime list comes from the asset;
 *  a drift test asserts the two agree. */
export type CanonicalStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
/** The canonical work-item priorities (compile-time contract). */
export type WorkPriority = "urgent" | "high" | "medium" | "low" | "none";

const entries: WorkVocabEntry[] = [...WORK_VOCABULARY_DATA].sort((a, b) => a.order - b.order);
const statusEntries = entries.filter((e) => e.kind === "status");
const priorityEntries = entries.filter((e) => e.kind === "priority");

/** Canonical statuses in board order (backlog → cancelled). */
export const CANONICAL_STATUS: readonly CanonicalStatus[] = statusEntries.map((e) => e.id as CanonicalStatus);
/** Canonical priorities in ranked order (urgent → none). */
export const WORK_PRIORITIES: readonly WorkPriority[] = priorityEntries.map((e) => e.id as WorkPriority);

/** Canonical status → its lifecycle class. */
export const STATUS_CLASS: Record<CanonicalStatus, StatusClass> = Object.fromEntries(
  statusEntries.map((e) => [e.id, e.lifecycle ?? "open"]),
) as Record<CanonicalStatus, StatusClass>;

/** Canonical status → its display label. */
export const STATUS_LABEL: Record<CanonicalStatus, string> = Object.fromEntries(
  statusEntries.map((e) => [e.id, e.label]),
) as Record<CanonicalStatus, string>;

/** Canonical priority → its display label. */
export const PRIORITY_LABEL: Record<WorkPriority, string> = Object.fromEntries(
  priorityEntries.map((e) => [e.id, e.label]),
) as Record<WorkPriority, string>;

/** The full vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function workVocabulary(): WorkVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the vocabulary: statuses + priorities grouped by kind. This is BOTH the
 *  `values` seeded into the system `work-vocabulary` config def AND the base a scope resolver folds
 *  org/programme/project/user overrides onto — one source of truth for the shipped default. */
export interface WorkVocabularyValues {
  statuses: Array<{ id: string; label: string; order: number; lifecycle: StatusClass }>;
  priorities: Array<{ id: string; label: string; order: number }>;
}

/** Build the shipped-default {@link WorkVocabularyValues} from the canonical entries. */
export function workVocabularyValues(): WorkVocabularyValues {
  return {
    statuses: statusEntries.map((e) => ({ id: e.id, label: e.label, order: e.order, lifecycle: e.lifecycle ?? "open" })),
    priorities: priorityEntries.map((e) => ({ id: e.id, label: e.label, order: e.order })),
  };
}
