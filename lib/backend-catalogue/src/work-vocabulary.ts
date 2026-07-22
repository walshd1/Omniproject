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
  /** The base/default label (the authoring language). */
  label: string;
  /** Optional per-locale translations (BCP-47 key → text). A viewer sees {@link localeLabel}. */
  labels?: Record<string, string>;
  order: number;
  lifecycle?: StatusClass;
  /** Swatch colour as a 6-digit hex, rendered via inline style (absent ⇒ a neutral swatch). */
  color?: string;
  /** Methodology tags this token belongs to ("*" = neutral / all). Absent ⇒ neutral. Lets each
   *  methodology carry its own normal status nomenclature (surfaced by {@link statusesForMethodology}). */
  methodologies?: string[];
  /**
   * ADJUSTABLE-STATUS BINDING. A status is free to be defined (any id/label a way-of-working needs);
   * the ONE invariant is that a non-core status must bind to one of the internal canonical statuses —
   * the lifecycle anchors the broker/SoR actually reasons about. A CORE status has NO `canonical` (it
   * IS canonical, and its own `lifecycle` is the anchor). An ADJUSTABLE status sets `canonical` to the
   * internal status it maps onto, and inherits that anchor's lifecycle class. This is the status-axis
   * of the same "custom, but bound at the broker seam" model that field-mapping uses for fields.
   */
  canonical?: CanonicalStatus;
  /**
   * ADJUSTABLE-PRIORITY BINDING (priorities only). A priority is bound to an internal RANK — its ordinal
   * level (higher = more urgent), the invariant the sorting + RICE/WSJF weighting key off. This is kept
   * SEPARATE from `order` (display position): the five shipped priorities ARE the rank anchors (none=0 …
   * urgent=4), and an adjustable priority declares which rank band it binds to, exactly as a non-core
   * status declares its lifecycle class. Absent on statuses.
   */
  rank?: number;
}

/** A token's methodology tags, defaulting to neutral ("*") when untagged. */
export const vocabMethodologies = (e: Pick<WorkVocabEntry, "methodologies">): string[] =>
  e.methodologies && e.methodologies.length ? e.methodologies : ["*"];

/** The label a viewer in `locale` sees: an exact locale match, else the base language ("de-DE" → "de"),
 *  else the default `label`. So one screen renders in each user's language without a re-fetch. */
export const localeLabel = (token: { label: string; labels?: Record<string, string> }, locale?: string | null): string => {
  if (!locale || !token.labels) return token.label;
  const exact = token.labels[locale];
  if (exact) return exact;
  const lang = locale.split("-")[0];
  return (lang && token.labels[lang]) || token.label;
};

/** True when a token applies to `methodologyId` — neutral ("*") tokens always apply. */
export const vocabAppliesTo = (e: Pick<WorkVocabEntry, "methodologies">, methodologyId: string): boolean => {
  const tags = vocabMethodologies(e);
  return tags.includes("*") || tags.includes(methodologyId);
};

/** The canonical work-item statuses (compile-time contract). The runtime list comes from the asset;
 *  a drift test asserts the two agree. */
export type CanonicalStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
/** The canonical work-item priorities (compile-time contract). */
export type WorkPriority = "urgent" | "high" | "medium" | "low" | "none";

const entries: WorkVocabEntry[] = [...WORK_VOCABULARY_DATA].sort((a, b) => a.order - b.order);
const statusEntries = entries.filter((e) => e.kind === "status");
const priorityEntries = entries.filter((e) => e.kind === "priority");

/** The CORE (internal) statuses — those that ARE canonical (no `canonical` binding of their own).
 *  These are the lifecycle anchors the broker/SoR reasons about; adjustable statuses bind onto them. */
const coreStatusEntries = statusEntries.filter((e) => e.canonical === undefined);

/** Canonical (internal) statuses in board order (backlog → cancelled). Derived from the CORE statuses
 *  only, so adding adjustable statuses never widens the internal contract (a drift test asserts the set). */
export const CANONICAL_STATUS: readonly CanonicalStatus[] = coreStatusEntries.map((e) => e.id as CanonicalStatus);
/** Canonical priorities in ranked order (urgent → none). */
export const WORK_PRIORITIES: readonly WorkPriority[] = priorityEntries.map((e) => e.id as WorkPriority);

/** Canonical priority → its internal RANK (ordinal level, higher = more urgent) — the invariant the
 *  sorting + RICE/WSJF weighting key off, distinct from display `order`. The five shipped priorities ARE
 *  the rank anchors (none=0 … urgent=4); an adjustable priority binds to a rank band (see
 *  {@link priorityWeightBand}). Derived from the shipped entries, so a drift test can assert the anchors. */
export const PRIORITY_RANK: Record<WorkPriority, number> = Object.fromEntries(
  priorityEntries.map((e) => [e.id, e.rank ?? 0]),
) as Record<WorkPriority, number>;

/** The distinct ranks of the shipped priority anchors, ascending — the canonical weight bands. */
const PRIORITY_RANK_ANCHORS: readonly number[] = [...new Set(Object.values(PRIORITY_RANK))].sort((a, b) => a - b);

/**
 * Snap an arbitrary priority rank onto the NEAREST canonical priority weight band (one of the five shipped
 * anchor ranks). This is how an ADJUSTABLE priority — whatever ordinal a scope declares for it — still
 * resolves a weight the RICE/WSJF + sorting maths understand: it falls back to its nearest ranked neighbour
 * (ties break toward the more-urgent, i.e. higher, band). Returns null only when there are no anchors.
 */
export function priorityWeightBand(rank: number): number | null {
  if (!PRIORITY_RANK_ANCHORS.length) return null;
  let best = PRIORITY_RANK_ANCHORS[0]!;
  for (const anchor of PRIORITY_RANK_ANCHORS) {
    const d = Math.abs(anchor - rank);
    const bd = Math.abs(best - rank);
    if (d < bd || (d === bd && anchor > best)) best = anchor;
  }
  return best;
}

/** Canonical status → its lifecycle class. */
export const STATUS_CLASS: Record<CanonicalStatus, StatusClass> = Object.fromEntries(
  coreStatusEntries.map((e) => [e.id, e.lifecycle ?? "open"]),
) as Record<CanonicalStatus, StatusClass>;

/** Canonical status → its display label. */
export const STATUS_LABEL: Record<CanonicalStatus, string> = Object.fromEntries(
  coreStatusEntries.map((e) => [e.id, e.label]),
) as Record<CanonicalStatus, string>;

/** Every defined status id → the CORE canonical status it resolves to. A core status maps to itself;
 *  an adjustable status maps to its `canonical` binding. This is the status-axis resolver that keeps
 *  any custom status tied to an internal broker anchor. */
const STATUS_CANONICAL: Record<string, CanonicalStatus> = Object.fromEntries(
  statusEntries.map((e) => [e.id, (e.canonical ?? e.id) as CanonicalStatus]),
);

/**
 * Resolve ANY status id (core or adjustable) to its internal canonical status — the broker lifecycle
 * anchor. Returns null for an unknown id (so callers can fall back to native/synonym resolution).
 */
export function canonicalStatusOf(statusId: string | null | undefined): CanonicalStatus | null {
  if (!statusId) return null;
  return STATUS_CANONICAL[statusId] ?? null;
}

/**
 * The lifecycle class of ANY status id (core or adjustable), via its canonical binding. Unknown ⇒ "open"
 * (default-safe: an unclassified status is treated as still-open work). This is what completion/roll-up
 * maths key off, so an adjustable status behaves exactly like the internal status it binds to.
 */
export function statusClassOf(statusId: string | null | undefined): StatusClass {
  const canon = canonicalStatusOf(statusId);
  return canon ? STATUS_CLASS[canon] : "open";
}

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
export interface ResolvedStatus { id: string; label: string; labels?: Record<string, string>; order: number; lifecycle: StatusClass; methodologies: string[]; color?: string; canonical?: CanonicalStatus }
export interface ResolvedPriority { id: string; label: string; labels?: Record<string, string>; order: number; rank: number; methodologies: string[]; color?: string }
export interface WorkVocabularyValues {
  statuses: ResolvedStatus[];
  priorities: ResolvedPriority[];
}

/** Build the shipped-default {@link WorkVocabularyValues} from the canonical entries. */
export function workVocabularyValues(): WorkVocabularyValues {
  return {
    statuses: statusEntries.map((e) => ({ id: e.id, label: e.label, order: e.order, lifecycle: e.canonical ? STATUS_CLASS[e.canonical] : (e.lifecycle ?? "open"), methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}), ...(e.canonical ? { canonical: e.canonical } : {}) })),
    priorities: priorityEntries.map((e) => ({ id: e.id, label: e.label, order: e.order, rank: e.rank ?? PRIORITY_RANK[e.id as WorkPriority] ?? 0, methodologies: vocabMethodologies(e), ...(e.labels ? { labels: e.labels } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** The tokens (statuses OR priorities) that apply to `methodologyId` — its tagged ones plus the neutral
 *  ("*") ones — a methodology's normal nomenclature. Pass the shipped default or a resolved set. */
export function tokensForMethodology<T extends { methodologies: string[] }>(methodologyId: string, tokens: readonly T[]): T[] {
  return tokens.filter((t) => vocabAppliesTo(t, methodologyId));
}

/** The statuses that apply to `methodologyId` (thin wrapper over {@link tokensForMethodology}). */
export function statusesForMethodology(methodologyId: string, statuses: readonly ResolvedStatus[] = workVocabularyValues().statuses): ResolvedStatus[] {
  return tokensForMethodology(methodologyId, statuses);
}

/** The priorities that apply to `methodologyId` (thin wrapper over {@link tokensForMethodology}). */
export function prioritiesForMethodology(methodologyId: string, priorities: readonly ResolvedPriority[] = workVocabularyValues().priorities): ResolvedPriority[] {
  return tokensForMethodology(methodologyId, priorities);
}
