import { combine } from "./combine";
import { resolveOwnership } from "./ownership";
import { scatter } from "./scatter";
import type { CompositeRecord, CompositeWriteResult, OwnershipPlan, StoreAdapter, StoreFragment } from "./types";

/**
 * The Compositor drives the tier over a set of south-seam `StoreAdapter`s. It is STATELESS — it holds
 * only the (config) adapter set; every read re-fans-out and every write re-scatters, so nothing
 * accumulates between calls. A read that hits a downed store degrades to an HONEST partial rather than
 * failing; a write that partly fails returns an honest partial (there is deliberately NO cross-store
 * transaction — each store's write is independent and idempotent).
 */
export class Compositor {
  constructor(private readonly adapters: readonly StoreAdapter[]) {}

  private planFor(entityType: string): OwnershipPlan {
    return resolveOwnership(this.adapters.map((a) => a.capability(entityType)));
  }

  private adapter(storeId: string): StoreAdapter {
    const a = this.adapters.find((x) => x.storeId === storeId);
    if (!a) throw new Error(`composition: no adapter for storeId "${storeId}"`);
    return a;
  }

  /** Fan out to every store, combine into one record per id. A throwing store degrades to `unavailable`
   *  for the fields it surfaces (so the read still returns, just honestly partial there). */
  async readComposite(entityType: string, ids: string[]): Promise<CompositeRecord[]> {
    const plan = this.planFor(entityType);
    const perAdapter = await Promise.all(
      this.adapters.map(async (a): Promise<StoreFragment[]> => {
        try {
          return await a.read(entityType, ids);
        } catch {
          const cap = a.capability(entityType);
          const surfaced = Object.keys(cap.fields).filter((f) => cap.fields[f]?.surface);
          return ids.map(() => ({ storeId: a.storeId, role: a.role, values: {}, unavailableFields: surfaced }));
        }
      }),
    );
    return ids.map((id, i) => {
      const fragments = perAdapter.map((frs) => frs[i]).filter((f): f is StoreFragment => !!f);
      return combine({ id, plan, fragments });
    });
  }

  /** Scatter a patch to each field's writer and execute authoritative-first. Each store write is
   *  independent + idempotent; some-succeed-some-fail yields an honest `partial`, never a silent rollback. */
  async writeComposite(entityType: string, id: string, patch: Record<string, unknown>): Promise<CompositeWriteResult> {
    const plan = this.planFor(entityType);
    const { intents, unpersistable } = scatter({ plan, patch, roleOf: (storeId) => this.adapter(storeId).role });

    const applied: { storeId: string; fields: string[] }[] = [];
    let anyFailed = false;
    for (const intent of intents) {
      try {
        await this.adapter(intent.storeId).write(entityType, id, intent.fields);
        applied.push({ storeId: intent.storeId, fields: Object.keys(intent.fields) });
      } catch {
        anyFailed = true; // no cross-store transaction — keep what applied, report the truth
      }
    }
    return { ok: !anyFailed, applied, unpersistable, partial: anyFailed && applied.length > 0 };
  }
}
