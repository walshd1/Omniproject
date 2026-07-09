import { ROLE_PRECEDENCE, type OwnershipPlan, type ScatterPlan, type StoreRole, type UnpersistableField, type WriteIntent } from "./types";

/**
 * Scatter a patch to each field's SINGLE writer — the write half of the tier. A field with no writer is
 * never silently dropped: it's surfaced in `unpersistable[]` so the caller (and the operator) can see the
 * data has nowhere to live. Intents are ordered authoritative-first so the system-of-record is written
 * before any augmenting store.
 */
export function scatter(input: { plan: OwnershipPlan; patch: Record<string, unknown>; roleOf: (storeId: string) => StoreRole }): ScatterPlan {
  const byStore = new Map<string, WriteIntent>();
  const unpersistable: UnpersistableField[] = [];

  for (const [field, value] of Object.entries(input.patch)) {
    const writer = input.plan[field]?.writerStoreId ?? null;
    if (writer === null) {
      unpersistable.push({ field, value, reason: "no-writer" });
      continue;
    }
    let intent = byStore.get(writer);
    if (!intent) {
      intent = { storeId: writer, role: input.roleOf(writer), fields: {} };
      byStore.set(writer, intent);
    }
    intent.fields[field] = value;
  }

  const intents = [...byStore.values()].sort((a, b) => ROLE_PRECEDENCE[a.role] - ROLE_PRECEDENCE[b.role]);
  return { intents, unpersistable };
}
