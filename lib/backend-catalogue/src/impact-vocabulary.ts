/**
 * Canonical RAID/risk IMPACT vocabulary — the single source of truth for the impact grades OmniProject
 * knows about, their internal ordinal level and their display order. Authored as JSON
 * (assets/impact-vocabulary.json), validated + embedded by gen-impact-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as the severity vocabulary next to it.
 *
 * This is the IMPACT axis of a RAID/risk entry (the consequence magnitude if a risk materialises — the I in
 * risk-exposure P×I), one of the three graded risk vocabularies (severity / impact / likelihood). It lives
 * BELOW the seam because BOTH planes read it: the gateway's broker/vocabulary re-exports the level list
 * (single import surface preserved), and the SPA derives its impact order + labels from it — so the two can
 * never drift on WHICH grades exist. The internal ordinal LEVEL is the anchor the risk-exposure maths (P×I)
 * key off (see the api-server resolver's nearest-band fallback, so a scope-added grade still yields a number).
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { IMPACT_VOCABULARY_DATA } from "./impact-vocabulary.generated";

/** One canonical RAID/risk impact grade (with its internal ordinal level + display order). */
export interface ImpactVocabEntry {
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

/** The canonical RAID/risk impact grades (compile-time contract). The runtime list comes from the asset; a
 *  drift test asserts the two agree. */
export type CanonicalImpact = "low" | "medium" | "high";

const entries: ImpactVocabEntry[] = [...IMPACT_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) impact grades in ascending order (low → high). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_IMPACT: readonly CanonicalImpact[] = entries.map((e) => e.id as CanonicalImpact);

/** Canonical impact grade → its internal ordinal level (the invariant the exposure/ordering key off). */
export const IMPACT_LEVEL: Record<CanonicalImpact, number> = Object.fromEntries(
  entries.map((e) => [e.id, e.level]),
) as Record<CanonicalImpact, number>;

/** Canonical impact grade → its display label. */
export const IMPACT_LABEL: Record<CanonicalImpact, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalImpact, string>;

/** The full impact vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function impactVocabulary(): ImpactVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the impact vocabulary: the grades. This is BOTH the `values` seeded into
 *  the system `impact-vocabulary` config def AND the base a scope resolver folds org/programme/project/user
 *  overrides onto — one source of truth for the shipped default. */
export interface ResolvedImpact { id: string; label: string; labels?: Record<string, string>; order: number; level: number; methodologies: string[]; color?: string }
export interface ImpactVocabularyValues {
  levels: ResolvedImpact[];
}

/** Build the shipped-default {@link ImpactVocabularyValues} from the canonical entries. */
export function impactVocabularyValues(): ImpactVocabularyValues {
  return {
    levels: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, level: e.level, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The impact grades that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass the
 *  shipped default or a resolved set. */
export function impactLevelsForMethodology(methodologyId: string, levels: readonly ResolvedImpact[] = impactVocabularyValues().levels): ResolvedImpact[] {
  return tokensForMethodology(methodologyId, levels);
}
