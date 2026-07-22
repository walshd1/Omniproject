/**
 * Canonical RAG/health BAND vocabulary — the single source of truth for the health reporting bands
 * OmniProject knows about (Red/Amber/Green), their internal ordinal band and their display order. Authored
 * as JSON (assets/rag-vocabulary.json), validated + embedded by gen-rag-vocabulary, drift-guarded in CI —
 * the same data-not-code pattern as the severity/impact/likelihood vocabularies next to it.
 *
 * This is the RAG/health axis (a project/programme's traffic-light status). It lives BELOW the seam because
 * BOTH planes read it: the gateway's broker/vocabulary re-exports the band list (single import surface
 * preserved) and the SPA derives its band order + labels from it — so the two can never drift on WHICH bands
 * exist. IMPORTANT: this vocabulary is the DISPLAY/relabel layer — a scope can relabel Green → "On Track" or
 * add a band. The 3-way classifier (`classifyRag` → GREEN/AMBER/RED) and every health roll-up that keys off
 * it stay in code and are UNCHANGED; the internal ordinal BAND here is what an adjustable band binds to.
 */
import { vocabMethodologies, tokensForMethodology } from "./work-vocabulary";
import { RAG_VOCABULARY_DATA } from "./rag-vocabulary.generated";

/** One canonical RAG/health band (with its internal ordinal band + display order). */
export interface RagVocabEntry {
  id: string;
  /** The base/default label (the authoring language, e.g. "Green" — a scope may relabel to "On Track"). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  /** The internal ordinal BAND this token binds to — the ONE invariant kept for the health maths (1 = worst
   *  / Red … ascending to healthiest / Green). Every band (shipped OR a scope-added custom one) must declare
   *  it, so a custom band sorts/filters exactly like the internal ordinal it binds to. */
  level: number;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this band belongs to ("*" = neutral / all). Absent ⇒ neutral. */
  methodologies?: string[];
}

/** The canonical RAG/health bands (compile-time contract). The runtime list comes from the asset; a drift
 *  test asserts the two agree. Mirrors the classifier's three-way GREEN/AMBER/RED mapping (lower-cased ids). */
export type CanonicalRag = "red" | "amber" | "green";

const entries: RagVocabEntry[] = [...RAG_VOCABULARY_DATA].sort((a, b) => a.order - b.order);

/** Canonical (internal) RAG bands in ascending health order (red → green). Derived from the shipped
 *  entries, so a drift test can assert the set never silently changes. */
export const CANONICAL_RAG: readonly CanonicalRag[] = entries.map((e) => e.id as CanonicalRag);

/** Canonical RAG band → its internal ordinal band (the invariant the ordering/filtering key off). */
export const RAG_BAND_LEVEL: Record<CanonicalRag, number> = Object.fromEntries(
  entries.map((e) => [e.id, e.level]),
) as Record<CanonicalRag, number>;

/** Canonical RAG band → its display label. */
export const RAG_BAND_LABEL: Record<CanonicalRag, string> = Object.fromEntries(
  entries.map((e) => [e.id, e.label]),
) as Record<CanonicalRag, string>;

/** The full RAG vocabulary (a defensive copy) — for a consumer that needs the raw entries. */
export function ragVocabulary(): RagVocabEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** The scope-layerable shape of the RAG vocabulary: the bands. This is BOTH the `values` seeded into the
 *  system `rag-vocabulary` config def AND the base a scope resolver folds org/programme/project/user
 *  overrides onto — one source of truth for the shipped default. */
export interface ResolvedRag { id: string; label: string; labels?: Record<string, string>; order: number; level: number; methodologies: string[]; color?: string }
export interface RagVocabularyValues {
  bands: ResolvedRag[];
}

/** Build the shipped-default {@link RagVocabularyValues} from the canonical entries. */
export function ragVocabularyValues(): RagVocabularyValues {
  return {
    bands: entries.map((e) => ({ id: e.id, label: e.label, order: e.order, level: e.level, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The RAG bands that apply to `methodologyId` — its tagged ones plus the neutral ("*") ones. Pass the
 *  shipped default or a resolved set. */
export function ragBandsForMethodology(methodologyId: string, bands: readonly ResolvedRag[] = ragVocabularyValues().bands): ResolvedRag[] {
  return tokensForMethodology(methodologyId, bands);
}
