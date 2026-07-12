import { createHash } from "node:crypto";
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
 * It also holds the FIELD-IDENTITY HASH (`fieldIdentity`) — the stable identity of a single field value
 * that is INDEPENDENT of which backend served it, built from the project's correlation GUID
 * (`omniInstanceId`), the broker it came through, and the source field name. Two backends feeding the
 * same field of the same project produce the same hash, which is what lets records assemble by project
 * across backends. This lives below the broker seam by design (the gateway never assembles).
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

/**
 * The FIELD-IDENTITY HASH: a stable, backend-independent id for one field of one project instance,
 * derived from the project's correlation GUID (`omniInstanceId`), the `broker` it was reached through,
 * and the native `sourceField` name. Combining "project clarity" (the GUID) with "which value" (broker
 * · sourceField) in one hash means the same logical value has the same identity no matter which backend
 * served it — the key on which cross-backend assembly turns. Uses a space separator (which can't occur
 * in a broker kind or GUID) and SHA-256 for a fixed-width, collision-resistant key.
 */
export function fieldIdentity(omniInstanceId: string, broker: string, sourceField: string): string {
  return createHash("sha256").update([omniInstanceId, broker, sourceField].join(" ")).digest("hex");
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
