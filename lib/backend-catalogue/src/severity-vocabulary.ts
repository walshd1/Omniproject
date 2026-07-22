/**
 * Canonical RAID/risk SEVERITY vocabulary — the single source of truth for the severity grades OmniProject
 * knows about, their internal ordinal level and their display order. Authored as JSON
 * (assets/severity-vocabulary.json), validated + embedded by gen-severity-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as the energy (GTD tank) vocabulary next to it.
 *
 * This is the SEVERITY axis of a RAID/risk entry ("how bad is it if this bites"), one of the three graded
 * risk vocabularies (severity / impact / likelihood). It lives BELOW the seam because BOTH planes read it:
 * the gateway's broker/vocabulary re-exports the level list (single import surface preserved), and the SPA
 * derives its severity order + labels from it — so the two can never drift on WHICH grades exist. The
 * internal ordinal LEVEL is the anchor the risk-exposure maths (P×I) key off (see the api-server resolver's
 * nearest-band fallback, so a scope-added grade still yields a bounded number).
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { SEVERITY_VOCABULARY_DATA } from "./severity-vocabulary.generated";

/** One canonical RAID/risk severity grade (with its internal ordinal level + display order). */
export interface SeverityVocabEntry {
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

/** The canonical RAID/risk severity grades (compile-time contract). The runtime list comes from the asset; a
 *  drift test asserts the two agree. KEEPS `critical` — the extra grade the RAID register already ships. */
export type CanonicalSeverity = "low" | "medium" | "high" | "critical";

const entries: SeverityVocabEntry[] = [...SEVERITY_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) severity grades in ascending order (low → critical). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_SEVERITY: readonly CanonicalSeverity[] = entries.map((e) => e.id as CanonicalSeverity);

/** Canonical severity grade → its internal ordinal level (the invariant the exposure/ordering key off). */
export const SEVERITY_LEVEL: Record<CanonicalSeverity, number> = Object.fromEntries(
  entries.map((e) => [e.id, e.level]),
) as Record<CanonicalSeverity, number>;

/** Canonical severity grade → its display label. */
export const SEVERITY_LABEL: Record<CanonicalSeverity, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalSeverity, string>;

/** The full severity vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function severityVocabulary(): SeverityVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the severity vocabulary: the grades. This is BOTH the `values` seeded into
 *  the system `severity-vocabulary` config def AND the base a scope resolver folds org/programme/project/user
 *  overrides onto — one source of truth for the shipped default. */
export interface ResolvedSeverity { id: string; label: string; labels?: Record<string, string>; order: number; level: number; methodologies: string[]; color?: string }
export interface SeverityVocabularyValues {
  levels: ResolvedSeverity[];
}

/** Build the shipped-default {@link SeverityVocabularyValues} from the canonical entries. */
export function severityVocabularyValues(): SeverityVocabularyValues {
  return {
    levels: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, level: e.level, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The severity grades that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass the
 *  shipped default or a resolved set. */
export function severityLevelsForMethodology(methodologyId: string, levels: readonly ResolvedSeverity[] = severityVocabularyValues().levels): ResolvedSeverity[] {
  return tokensForMethodology(methodologyId, levels);
}
