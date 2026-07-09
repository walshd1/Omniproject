/**
 * Composition-tier types — the vocabulary of the stateless "brain" that sits between the broker
 * (north seam) and the store adapters (south seam). The tier HOLDS NOTHING: a read COMBINES fragments
 * from every store into one record; a write SCATTERS a patch to each field's single owner. All the
 * logic below is pure and derive-only, so it runs identically wherever it's called.
 *
 * Provenance re-uses OUR existing lineage vocabulary (the five members that appear on
 * `HistoryState.provenance` in broker/types.ts) — we do NOT invent a "cached" provenance; a cache hit
 * is `sourced` data carried with a `cached` FRESHNESS instead (freshness ≠ provenance).
 */

/** A store's role. Precedence is exactly this order: authoritative ▸ augmenting ▸ cache. */
export type StoreRole = "authoritative" | "augmenting" | "cache";

/** Precedence weight — lower binds tighter (authoritative wins). */
export const ROLE_PRECEDENCE: Record<StoreRole, number> = { authoritative: 0, augmenting: 1, cache: 2 };

/**
 * Why a field has (or lacks) a value after composition:
 *  - present     — a store returned a real value;
 *  - empty       — a store that CAN hold the field returned nothing (a real, surfaced "no value");
 *  - absent      — no store can even surface the field (it's off the manifest — not the same as empty);
 *  - unavailable — the owning store was down, so we genuinely don't know.
 */
export type FieldAvailability = "present" | "empty" | "absent" | "unavailable";

/** OUR lineage enum — must match the literals used across broker/types.ts. Never add "cached" here. */
export type Provenance = "sourced" | "derived" | "sample" | "replayed" | "projected";

/** Freshness is orthogonal to provenance: live from the store, or served from a cache as-of a time. */
export type Freshness = { kind: "live" } | { kind: "cached"; asOf: string };

/** One field's resolved value plus the honest lineage of how we got it. */
export interface FieldValue {
  value: unknown;
  availability: FieldAvailability;
  provenance: Provenance;
  freshness: Freshness;
  /** The store the value (or the "empty"/"unavailable" verdict) came from; null when nothing surfaced it. */
  storeId: string | null;
}

/** Whether a store can SURFACE (read) and/or STORE (write) a field — mirrors broker `FieldSupport`. */
export interface FieldSupport {
  surface: boolean;
  store: boolean;
}

/** What one store can do for an entity type: its role + per-field surface/store support. */
export interface StoreCapability {
  storeId: string;
  role: StoreRole;
  fields: Record<string, FieldSupport>;
}

/** A single store's contribution to one record read. `unavailableFields` marks fields the store OWNS
 *  but could not answer for (it was down), so the compositor can report `unavailable` honestly. */
export interface StoreFragment {
  storeId: string;
  role: StoreRole;
  /** When the fragment came from a cache, the as-of time to carry into freshness. */
  asOf?: string;
  values: Record<string, unknown>;
  unavailableFields?: string[];
}

/** The resolved ownership of ONE field across the store set. */
export interface FieldOwnership {
  /** The single store allowed to WRITE this field, or null when no store can persist it (→ unpersistable). */
  writerStoreId: string | null;
  /** Ordered read fallback: highest-precedence first, cache always LAST. */
  readOrder: string[];
  /** True when at least one store can surface the field; false ⇒ the field is `absent`, not `empty`. */
  surfaceable: boolean;
}

/** field → its resolved ownership. The pure output of `resolveOwnership`. */
export type OwnershipPlan = Record<string, FieldOwnership>;

/** A composed record: id + one FieldValue per planned field. */
export interface CompositeRecord {
  id: string;
  fields: Record<string, FieldValue>;
}

/** A field that could not be routed to any writer on a scatter — surfaced, never silently dropped. */
export interface UnpersistableField {
  field: string;
  value: unknown;
  reason: "no-writer";
}

/** A single write intent produced by `scatter`, ordered authoritative-first. */
export interface WriteIntent {
  storeId: string;
  role: StoreRole;
  fields: Record<string, unknown>;
}

/** The pure output of `scatter`: routed intents + the fields nothing can persist. */
export interface ScatterPlan {
  intents: WriteIntent[];
  unpersistable: UnpersistableField[];
}

/**
 * The south-seam contract the compositor drives. A StoreAdapter is a thin, role-tagged façade over one
 * backing store (a broker-backed backend, a cache, or the self-host DB) — it reads/writes ENABLED
 * fields only and never leaks action strings upward. Deliberately generic (entityType + ids/fields) so
 * the compositor is store-agnostic; concrete adapters map these onto their own typed calls.
 */
export interface StoreAdapter {
  readonly storeId: string;
  readonly role: StoreRole;
  /** What this store can surface/store for an entity type (per-field support). */
  capability(entityType: string): StoreCapability;
  /** Read the given ids; return one fragment per id (a throwing adapter degrades to a partial upstream). */
  read(entityType: string, ids: string[]): Promise<StoreFragment[]>;
  /** Write the given fields for one id; idempotent, single-store, no cross-store transaction. */
  write(entityType: string, id: string, fields: Record<string, unknown>): Promise<void>;
  /** Optional as-of stamp for cache/time-travel stores, carried into freshness. */
  asOf?(): string | undefined;
}

/** The honest result of a composite write: what applied, what nothing could persist, and whether the
 *  overall write is a partial (some stores succeeded, some failed) rather than a clean all-or-nothing. */
export interface CompositeWriteResult {
  ok: boolean;
  applied: { storeId: string; fields: string[] }[];
  unpersistable: UnpersistableField[];
  partial: boolean;
}
