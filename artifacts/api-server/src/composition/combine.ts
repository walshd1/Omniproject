import type { CompositeRecord, FieldValue, Freshness, OwnershipPlan, StoreFragment } from "./types";

/** A value counts as "present" unless it's null/undefined/empty-string (0 and false ARE present). */
function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** Freshness for a winning fragment: cached (with as-of) when it came from a cache store, else live. */
function freshnessOf(frag: StoreFragment): Freshness {
  return frag.role === "cache" || frag.asOf !== undefined ? { kind: "cached", asOf: frag.asOf ?? "" } : { kind: "live" };
}

/**
 * Combine every store's fragment into one record — the read half of the tier. Per field we walk the
 * plan's `readOrder` and resolve an HONEST availability:
 *  - a present value WINS (first one in precedence order — cache is last);
 *  - an OWNING store reached with no value STOPS the search and yields `empty` (an authoritative "no
 *    value" must never be overridden by a lower store);
 *  - an unavailable OWNER (its store was down for this field) is skipped so we can fall through, but is
 *    REMEMBERED — if nothing is then found the field is `unavailable`, not a false `empty`;
 *  - nothing found and no owner was down ⇒ `empty`;
 *  - not surfaceable at all ⇒ `absent` (off the manifest).
 * A cache hit carries provenance `sourced` with a `cached` freshness — freshness, not a fake provenance.
 */
export function combine(input: { id: string; plan: OwnershipPlan; fragments: readonly StoreFragment[] }): CompositeRecord {
  const byStore = new Map(input.fragments.map((f) => [f.storeId, f]));
  const fields: Record<string, FieldValue> = {};

  for (const [field, own] of Object.entries(input.plan)) {
    if (!own.surfaceable) {
      fields[field] = { value: undefined, availability: "absent", provenance: "sourced", freshness: { kind: "live" }, storeId: null };
      continue;
    }

    let ownerWasDown = false;
    let resolved: FieldValue | null = null;

    for (const storeId of own.readOrder) {
      const isOwner = storeId === own.writerStoreId;
      const frag = byStore.get(storeId);
      const down = !frag || (frag.unavailableFields?.includes(field) ?? false);

      if (down) {
        if (isOwner) ownerWasDown = true; // remember the owner outage; fall through to fallbacks
        continue;
      }
      if (hasValue(frag!.values[field])) {
        resolved = { value: frag!.values[field], availability: "present", provenance: "sourced", freshness: freshnessOf(frag!), storeId };
        break; // a present value wins
      }
      if (isOwner) {
        // The owner is up and holds no value → a real, authoritative empty. Stop; don't let a lower store shadow it.
        resolved = { value: undefined, availability: "empty", provenance: "sourced", freshness: freshnessOf(frag!), storeId };
        break;
      }
      // A non-owner with no value: fall through to the next store.
    }

    fields[field] = resolved ?? {
      value: undefined,
      availability: ownerWasDown ? "unavailable" : "empty",
      provenance: "sourced",
      freshness: { kind: "live" },
      storeId: null,
    };
  }

  return { id: input.id, fields };
}

/** A record is PARTIAL when any field is `unavailable` — an owner was down, so the read is incomplete. */
export function isPartial(record: CompositeRecord): boolean {
  return Object.values(record.fields).some((f) => f.availability === "unavailable");
}
