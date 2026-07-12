import { encComponent, decComponent, matchComponent } from "./field-cipher";
import type { Row } from "./types";

/**
 * Cross-backend identity. A backend's `id` is unique only WITHIN that backend, so when more than one
 * broker/backend can feed the read model the global key must be qualified by `source`. This module keeps
 * that qualification in one place:
 *   - every row carries a `source` (stamped at the seam if a backend omits it), and
 *   - the global key is `source:id`, so two backends that happen to mint the same `id` never collide and
 *     never silently merge two distinct projects (or misroute a write).
 * Pure + stateless; nothing is stored.
 *
 * It also builds the FIELD IDENTITY — the backend-independent identity of one wired field. It is built
 * from the WIRING, not from any backend echo: the moment an admin routes a field (vendor · broker ·
 * sourceField) it has an identity; routing it to a project folds the project's correlation GUID in. So
 * OmniProject computes the whole identity from its own config + the project GUID — nothing needs storing
 * or returning by Jira/etc.
 *
 * The identity is a SET of ciphertext PIECES, one per component (project, vendor, broker, field), each a
 * deterministic cipher (see field-cipher). That gives multiple pieces to match against a lookup — group
 * by the `project` piece to collect a project's fields across backends, by the `field` piece to find the
 * same field everywhere — and it is reversible (`parseFieldIdentity` decrypts every piece back). Lives
 * below the broker seam by design (the gateway never assembles).
 */

/** The plaintext components of a wired field's identity. */
export interface FieldIdentityParts {
  /** The project's correlation GUID (added when the field is wired to a project). */
  omniInstanceId: string;
  /** The backend/vendor the field is wired to (e.g. the routing `vendor`). */
  vendor: string;
  /** The broker it is reached through. */
  broker: string;
  /** The vendor's native field/column name. */
  sourceField: string;
}

/** The field identity as ciphertext pieces — one opaque, matchable piece per component. */
export interface FieldIdentity {
  project: string;
  vendor: string;
  broker: string;
  field: string;
}

/** The globally-unique key for an entity: `source:id`. */
export function qualifyId(source: string | null | undefined, id: string): string {
  const s = (source ?? "").trim();
  return s ? `${s}:${id}` : id;
}

/** Read the qualified key off a row (its own `source`, or a fallback when the backend omitted it). */
export function qualifiedId(row: Row, fallbackSource?: string): string {
  const source = typeof row["source"] === "string" && row["source"] ? (row["source"] as string) : fallbackSource;
  return qualifyId(source, String(row["id"]));
}

/** Component labels — domain-separate the pieces so a `project` piece never matches a `vendor` piece. */
const LABELS = { project: "project", vendor: "vendor", broker: "broker", field: "field" } as const;

/**
 * Build a field identity from its plaintext components: a set of deterministic ciphertext pieces, one
 * per component. The same wiring + project always produces the same pieces (matchable); every piece is
 * reversible via {@link parseFieldIdentity}. Computed entirely from OmniProject's own wiring + the
 * project GUID — no backend has to store or echo anything.
 */
export function fieldIdentity(parts: FieldIdentityParts): FieldIdentity {
  return {
    project: encComponent(LABELS.project, parts.omniInstanceId),
    vendor: encComponent(LABELS.vendor, parts.vendor),
    broker: encComponent(LABELS.broker, parts.broker),
    field: encComponent(LABELS.field, parts.sourceField),
  };
}

/** Reverse of {@link fieldIdentity}: decrypt every piece back to its plaintext component, or `null` if
 *  any piece is missing/tampered/for the wrong component. */
export function parseFieldIdentity(id: FieldIdentity | null | undefined): FieldIdentityParts | null {
  if (!id) return null;
  const omniInstanceId = decComponent(LABELS.project, id.project);
  const vendor = decComponent(LABELS.vendor, id.vendor);
  const broker = decComponent(LABELS.broker, id.broker);
  const sourceField = decComponent(LABELS.field, id.field);
  if (omniInstanceId === null || vendor === null || broker === null || sourceField === null) return null;
  return { omniInstanceId, vendor, broker, sourceField };
}

/** Match one component piece against a candidate plaintext value — the "match against a lookup"
 *  primitive (e.g. does this identity's `project` piece belong to a given GUID?). */
export function matchIdentityComponent(piece: string, component: keyof typeof LABELS, value: string): boolean {
  return matchComponent(piece, LABELS[component], value);
}

/**
 * Stamp `source` onto every row that lacks one, using the broker kind it was read through. Guarantees
 * downstream identity + entity-resolution always have a key, regardless of whether a given backend
 * populates `source` itself. Mutates-and-returns the same array (read rows are freshly fetched, not shared).
 */
export function stampSource<T extends Row>(rows: T[], source: string): T[] {
  for (const r of rows) {
    if (typeof r["source"] !== "string" || !r["source"]) (r as Row)["source"] = source;
  }
  return rows;
}
