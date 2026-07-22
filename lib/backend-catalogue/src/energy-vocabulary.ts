/**
 * Canonical GTD ENERGY-LEVEL vocabulary — the single source of truth for the energy/effort levels
 * OmniProject knows about, their internal ordinal level and their display order. Authored as JSON
 * (assets/energy-vocabulary.json), validated + embedded by gen-energy-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as the task (GTD status) vocabulary next to it.
 *
 * This is the ENERGY axis (David Allen's "how much have I got in the tank" filter), DISTINCT from an hour
 * estimate and from the GTD status axis. It lives BELOW the seam because BOTH planes read it: the gateway's
 * broker/vocabulary re-exports the level list (single import surface preserved), and the SPA derives its
 * energy order + labels from it — so the two can never drift on WHICH energy levels exist.
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { ENERGY_VOCABULARY_DATA } from "./energy-vocabulary.generated";

/** One canonical GTD energy-level token (with its internal ordinal level + display order). */
export interface EnergyVocabEntry {
  id: string;
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** The internal ordinal LEVEL this token binds to — the ONE invariant kept for the energy maths. Every
   *  level (shipped OR a scope-added custom one) must declare it, so a custom level sorts/filters exactly
   *  like the internal ordinal band it binds to. */
  level: number;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this level belongs to ("*" = neutral / all). Absent ⇒ neutral. */
  methodologies?: string[];
}

/** The canonical GTD energy levels (compile-time contract). The runtime list comes from the asset; a
 *  drift test asserts the two agree. */
export type CanonicalEnergy = "low" | "medium" | "high";

const entries: EnergyVocabEntry[] = [...ENERGY_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) GTD energy levels in ascending order (low → high). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_ENERGY: readonly CanonicalEnergy[] = entries.map((e) => e.id as CanonicalEnergy);

/** Canonical energy level → its internal ordinal level (the invariant the ordering/filtering key off). */
export const ENERGY_LEVEL: Record<CanonicalEnergy, number> = Object.fromEntries(
  entries.map((e) => [e.id, e.level]),
) as Record<CanonicalEnergy, number>;

/** Canonical energy level → its display label. */
export const ENERGY_LABEL: Record<CanonicalEnergy, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalEnergy, string>;

/** The full energy vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function energyVocabulary(): EnergyVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the energy vocabulary: the levels. This is BOTH the `values` seeded into
 *  the system `energy-vocabulary` config def AND the base a scope resolver folds org/programme/project/user
 *  overrides onto — one source of truth for the shipped default. */
export interface ResolvedEnergy { id: string; label: string; labels?: Record<string, string>; order: number; level: number; methodologies: string[]; color?: string }
export interface EnergyVocabularyValues {
  levels: ResolvedEnergy[];
}

/** Build the shipped-default {@link EnergyVocabularyValues} from the canonical entries. */
export function energyVocabularyValues(): EnergyVocabularyValues {
  return {
    levels: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, level: e.level, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The energy levels that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass the
 *  shipped default or a resolved set. */
export function energyLevelsForMethodology(methodologyId: string, levels: readonly ResolvedEnergy[] = energyVocabularyValues().levels): ResolvedEnergy[] {
  return tokensForMethodology(methodologyId, levels);
}
