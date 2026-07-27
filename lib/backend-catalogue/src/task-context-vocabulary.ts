/**
 * Canonical GTD TASK-CONTEXT vocabulary — the single source of truth for the @contexts OmniProject knows
 * about (David Allen's "where / with what tool can I do this" filter) and their display order. Authored as
 * JSON (assets/task-context-vocabulary.json), validated + embedded by gen-task-context-vocabulary, drift-
 * guarded in CI — the same data-not-code pattern as the energy (GTD tank) vocabulary next to it.
 *
 * This is the CONTEXT axis of a GTD next-action, DISTINCT from the status axis (task-vocabulary) and the
 * energy axis (energy-vocabulary). Unlike those it is a FLAT set — a context has a display `order` but no
 * internal ordinal `level` (there is no "more/less" of a context) — so it builds on `defineFlatVocabulary`.
 * It lives BELOW the seam because both planes read it: the gateway resolves the effective contexts for a
 * scope, and the SPA derives its context picker + colours from it. The shipped set is a curated default of
 * neutral GTD contexts; a scope may relabel / recolour / reorder / add / remove. Contexts remain FREE-TEXT
 * on the task write boundary by design (GTD encourages ad-hoc contexts) — this vocabulary is the suggested/
 * curated set for pickers, colours and grouping, not a closed enum.
 */
import { defineFlatVocabulary, type ResolvedFlat } from "./vocabulary-base";
import { TASK_CONTEXT_VOCABULARY_DATA } from "./task-context-vocabulary.generated";

/** One canonical GTD @context token (with its display order + optional colour). A FLAT vocabulary entry. */
export interface TaskContextVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this context belongs to ("*" = neutral / all). Absent ⇒ neutral. */
  methodologies?: string[];
}

/** The canonical GTD contexts (compile-time contract). The runtime list comes from the asset; a drift test
 *  asserts the two agree. */
export type CanonicalTaskContext = "anywhere" | "calls" | "computer" | "errands" | "home" | "office";

const vocab = defineFlatVocabulary<TaskContextVocabEntry>(TASK_CONTEXT_VOCABULARY_DATA);

/** Canonical (internal) GTD contexts in display order. Derived from the shipped entries, so a drift test can
 *  assert the set never silently changes. */
export const CANONICAL_TASK_CONTEXT: readonly CanonicalTaskContext[] = vocab.ids as readonly CanonicalTaskContext[];

/** Canonical context → its display label. */
export const TASK_CONTEXT_LABEL: Record<CanonicalTaskContext, string> = vocab.labelById as Record<CanonicalTaskContext, string>;

/** The full task-context vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function taskContextVocabulary(): TaskContextVocabEntry[] {
  return vocab.vocabulary();
}

/** The scope-layerable shape of the task-context vocabulary: the contexts. This is BOTH the `values` seeded
 *  into the system `task-context-vocabulary` config def AND the base a scope resolver folds org/programme/
 *  project/user overrides onto — one source of truth for the shipped default. */
export type ResolvedTaskContext = ResolvedFlat;
export interface TaskContextVocabularyValues {
  contexts: ResolvedTaskContext[];
}

/** Build the shipped-default {@link TaskContextVocabularyValues} from the canonical entries. */
export function taskContextVocabularyValues(): TaskContextVocabularyValues {
  return { contexts: vocab.resolved() };
}

/** The contexts that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass the shipped
 *  default or a resolved set. */
export function taskContextsForMethodology(
  methodologyId: string,
  contexts: readonly ResolvedTaskContext[] = taskContextVocabularyValues().contexts,
): ResolvedTaskContext[] {
  return vocab.forMethodology(methodologyId, contexts);
}
