import { ROLE_PRECEDENCE, type OwnershipPlan, type StoreCapability } from "./types";

/**
 * Resolve, per field, who WRITES it and in what order it's READ — the pure plan the compositor drives.
 *
 * Rules (all pure):
 *  - Writer = the highest-precedence store that can `store` the field. Caches NEVER write.
 *  - Read order = every store that can `surface` the field, highest-precedence first, with any CACHE
 *    appended LAST (a cache is only ever a fallback, never ahead of a real store).
 *  - AUGMENTING GUARD: an augmenting store may only own or read a field that NO authoritative store can
 *    store. If any authoritative store can store the field, the augmenting store is dropped from BOTH the
 *    writer choice and the read order — so an augmenting store can never shadow authoritative data, not
 *    even when the authoritative store is currently empty.
 *  - `surfaceable` = at least one (post-guard) store can surface the field. When false the field is
 *    `absent` (off the manifest) rather than `empty`.
 */
export function resolveOwnership(stores: readonly StoreCapability[]): OwnershipPlan {
  const plan: OwnershipPlan = {};
  // Stable precedence order (V8 sort is stable, so same-role stores keep declaration order).
  const ordered = [...stores].sort((a, b) => ROLE_PRECEDENCE[a.role] - ROLE_PRECEDENCE[b.role]);
  const nonCache = ordered.filter((s) => s.role !== "cache");
  const caches = ordered.filter((s) => s.role === "cache");

  const fields = new Set<string>();
  for (const s of stores) for (const f of Object.keys(s.fields)) fields.add(f);

  for (const field of fields) {
    const authoritativeCanStore = stores.some((s) => s.role === "authoritative" && s.fields[field]?.store);
    const readOrder: string[] = [];
    let writerStoreId: string | null = null;

    for (const s of nonCache) {
      const sup = s.fields[field];
      if (!sup) continue;
      // Augmenting can only participate when no authoritative store can store the field.
      if (s.role === "augmenting" && authoritativeCanStore) continue;
      if (sup.surface) readOrder.push(s.storeId);
      if (sup.store && writerStoreId === null) writerStoreId = s.storeId; // caches excluded here by construction
    }
    // Caches are read-only fallbacks, always last.
    for (const s of caches) if (s.fields[field]?.surface) readOrder.push(s.storeId);

    plan[field] = { writerStoreId, readOrder, surfaceable: readOrder.length > 0 };
  }
  return plan;
}
