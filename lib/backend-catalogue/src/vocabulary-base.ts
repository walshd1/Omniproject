/**
 * GRADED-VOCABULARY generic — the shared read-side spine of the level-based vocabularies (energy, impact,
 * likelihood, severity, rag). Each of those is an axis of near-identical shape: a JSON-authored list of
 * `{ id, label, order, level, … }` tokens where an internal ordinal `level` is the invariant its maths key
 * off. This folds the repeated boilerplate — the order sort, the canonical id list, the level/label records,
 * the defensive copy, the resolved-values builder and the methodology filter — into ONE place, so each
 * per-vocab module shrinks to a thin wrapper that only NAMES its exports and declares its compile-time
 * canonical type. Same idea as `defineCatalogue` for the read catalogues.
 *
 * The kind-partitioned (work) and class-based (task) vocabularies stay bespoke — their shapes are one-of-a-
 * kind (status+priority with rank/canonical binding; five GTD workflow classes with closed/done helpers).
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";

/** One graded vocabulary token: an id bound to an internal ordinal LEVEL, with display order and optional
 *  per-locale labels, swatch colour and methodology tags. The shared shape of the graded vocabularies. */
export interface GradedVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). */
  labels?: Record<string, string>;
  order: number;
  /** The internal ordinal LEVEL this token binds to — the ONE invariant the maths key off. */
  level: number;
  /** Swatch colour as a 6-digit hex (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this token belongs to ("*" = neutral / all). Absent ⇒ neutral. */
  methodologies?: string[];
}

/** The scope-layerable shape of a graded token: the entry with `methodologies` defaulted to neutral ("*"). */
export interface ResolvedGrade {
  id: string;
  label: string;
  labels?: Record<string, string>;
  order: number;
  level: number;
  methodologies: string[];
  color?: string;
}

/** The derived read-side surface of a graded vocabulary (see {@link defineGradedVocabulary}). */
export interface GradedVocabulary<E extends GradedVocabEntry> {
  /** Shipped entries, ascending by `order` (the live array — copy via {@link GradedVocabulary.vocabulary}). */
  entries: E[];
  /** The token ids in display order (the CANONICAL_* list). */
  ids: string[];
  /** id → internal ordinal level (the *_LEVEL record). */
  levelById: Record<string, number>;
  /** id → display label (the *_LABEL record). */
  labelById: Record<string, string>;
  /** The full vocabulary (a defensive copy). */
  vocabulary(): E[];
  /** The scope-layerable resolved grades (methodologies defaulted to neutral). */
  resolved(): ResolvedGrade[];
  /** The grades that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. */
  forMethodology(methodologyId: string, tokens?: readonly ResolvedGrade[]): ResolvedGrade[];
}

/**
 * Build a graded vocabulary from a JSON-authored token list. Sorts by `order`, then exposes the
 * canonical id list, the level/label lookup records, a defensive copy, the resolved-values builder (the
 * scope-layerable base a resolver folds overrides onto) and the methodology filter — the exact surface the
 * energy / impact / likelihood / severity / rag modules each re-export under their own names.
 */
export function defineGradedVocabulary<E extends GradedVocabEntry>(data: readonly E[]): GradedVocabulary<E> {
  const entries = [...data].sort((a, b) => a.order - b.order);
  const resolved = (): ResolvedGrade[] =>
    entries.map((e) => ({
      id: e.id,
      label: e.label,
      order: e.order,
      level: e.level,
      methodologies: vocabMethodologies(e),
      ...(e.labels ? { labels: e.labels } : {}),
      ...(e.color ? { color: e.color } : {}),
    }));
  return {
    entries,
    ids: entries.map((e) => e.id),
    levelById: Object.fromEntries(entries.map((e) => [e.id, e.level])),
    labelById: Object.fromEntries(entries.map((e) => [e.id, e.label])),
    vocabulary: () => entries.map((e) => ({ ...e })),
    resolved,
    forMethodology: (methodologyId, tokens = resolved()) => tokensForMethodology(methodologyId, tokens),
  };
}
