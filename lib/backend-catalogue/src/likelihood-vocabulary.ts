/**
 * Canonical RAID/risk LIKELIHOOD vocabulary — the single source of truth for the likelihood grades
 * OmniProject knows about, their internal ordinal level and their display order. Authored as JSON
 * (assets/likelihood-vocabulary.json), validated + embedded by gen-likelihood-vocabulary, drift-guarded in
 * CI — the same data-not-code pattern as the impact vocabulary next to it.
 *
 * This is the LIKELIHOOD axis of a RAID/risk entry (the probability a risk occurs — the P in risk-exposure
 * P×I), one of the three graded risk vocabularies (severity / impact / likelihood). It lives BELOW the seam
 * because BOTH planes read it: the gateway's broker/vocabulary re-exports the level list (single import
 * surface preserved), and the SPA derives its likelihood order + labels from it — so the two can never drift
 * on WHICH grades exist. The internal ordinal LEVEL is the anchor the risk-exposure maths (P×I) key off (see
 * the api-server resolver's nearest-band fallback, so a scope-added grade still yields a bounded number).
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { LIKELIHOOD_VOCABULARY_DATA } from "./likelihood-vocabulary.generated";

/** One canonical RAID/risk likelihood grade (with its internal ordinal level + display order). */
export interface LikelihoodVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** The internal ordinal LEVEL this grade binds to — the ONE invariant kept for the risk-exposure maths.
   *  Every grade (shipped OR a scope-added custom one) must declare it, so a custom grade sorts/filters and
   *  scores exactly like the internal ordinal band it binds to. */
  level: number;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this grade belongs to ("*" = neutral / all). Absent ⇒ neutral. */
  methodologies?: string[];
}

/** The canonical RAID/risk likelihood grades (compile-time contract). The runtime list comes from the asset;
 *  a drift test asserts the two agree. */
export type CanonicalLikelihood = "low" | "medium" | "high";

const entries: LikelihoodVocabEntry[] = [...LIKELIHOOD_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) likelihood grades in ascending order (low → high). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_LIKELIHOOD: readonly CanonicalLikelihood[] = entries.map((e) => e.id as CanonicalLikelihood);

/** Canonical likelihood grade → its internal ordinal level (the invariant the exposure/ordering key off). */
export const LIKELIHOOD_LEVEL: Record<CanonicalLikelihood, number> = Object.fromEntries(
  entries.map((e) => [e.id, e.level]),
) as Record<CanonicalLikelihood, number>;

/** Canonical likelihood grade → its display label. */
export const LIKELIHOOD_LABEL: Record<CanonicalLikelihood, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalLikelihood, string>;

/** The full likelihood vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function likelihoodVocabulary(): LikelihoodVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the likelihood vocabulary: the grades. This is BOTH the `values` seeded into
 *  the system `likelihood-vocabulary` config def AND the base a scope resolver folds org/programme/project/
 *  user overrides onto — one source of truth for the shipped default. */
export interface ResolvedLikelihood { id: string; label: string; labels?: Record<string, string>; order: number; level: number; methodologies: string[]; color?: string }
export interface LikelihoodVocabularyValues {
  levels: ResolvedLikelihood[];
}

/** Build the shipped-default {@link LikelihoodVocabularyValues} from the canonical entries. */
export function likelihoodVocabularyValues(): LikelihoodVocabularyValues {
  return {
    levels: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, level: e.level, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The likelihood grades that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass
 *  the shipped default or a resolved set. */
export function likelihoodLevelsForMethodology(methodologyId: string, levels: readonly ResolvedLikelihood[] = likelihoodVocabularyValues().levels): ResolvedLikelihood[] {
  return tokensForMethodology(methodologyId, levels);
}
