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
 * It also holds the FIELD-IDENTITY TOKEN (`fieldIdentity`) — the stable identity of a single field value
 * that is INDEPENDENT of which backend served it, encoding the project's correlation GUID
 * (`omniInstanceId`), the broker it came through, and the source field name. Two backends feeding the
 * same field of the same project produce the same token, which is what lets records assemble by project
 * across backends. The encoding is REVERSIBLE — every component can be recovered from the token alone
 * (`parseFieldIdentity`), with no lookup table. This lives below the broker seam by design (the gateway
 * never assembles).
 */

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

/** The three components a field-identity token encodes. */
export interface FieldIdentity {
  omniInstanceId: string;
  broker: string;
  sourceField: string;
}

/**
 * The FIELD-IDENTITY TOKEN: a stable, backend-independent id for one field of one project instance,
 * encoding the project's correlation GUID (`omniInstanceId`), the `broker` it was reached through, and
 * the native `sourceField` name. Combining "project clarity" (the GUID) with "which value" (broker ·
 * sourceField) means the same logical value has the same token no matter which backend served it — the
 * key on which cross-backend assembly turns.
 *
 * The encoding is REVERSIBLE (see `parseFieldIdentity`): each component is base64url-encoded (alphabet
 * A-Za-z0-9-_) and the three are joined with "." — which never occurs in base64url, so the split is
 * unambiguous and any character (dots, colons, spaces) is safe inside a component. No hashing, no lookup
 * table: every part is recoverable from the token alone.
 */
export function fieldIdentity(omniInstanceId: string, broker: string, sourceField: string): string {
  return [omniInstanceId, broker, sourceField].map((p) => Buffer.from(p, "utf8").toString("base64url")).join(".");
}

/** Reverse of {@link fieldIdentity}: recover the three components from a token, or `null` if the string
 *  isn't a well-formed field-identity token (wrong shape, or it doesn't round-trip). */
export function parseFieldIdentity(token: string): FieldIdentity | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [omniInstanceId, broker, sourceField] = parts.map((p) => Buffer.from(p, "base64url").toString("utf8")) as [string, string, string];
  // Validate by re-encoding: base64url decoding is lenient, so a token only counts if it round-trips.
  if (fieldIdentity(omniInstanceId, broker, sourceField) !== token) return null;
  return { omniInstanceId, broker, sourceField };
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
