import { useEffect, useState } from "react";

/**
 * The seed-draft-from-server / dirty-check / reset pattern shared by every settings admin panel
 * (rate card, custom reports, content pages, priority weights, cost rules, governance rules,
 * federated peers, rate grid, …): a draft is staged locally, reseeded whenever the server copy
 * changes underneath it, and considered dirty when it no longer matches what `toDraft` would
 * produce from the current server value. `toDraft` also doubles as the clone step (most callers
 * just pass `structuredClone`), so a draft can be freely mutated without touching the server copy.
 */
export function useDraftAdmin<S, D>(server: S | undefined, toDraft: (server: S) => D) {
  const [draft, setDraft] = useState<D | null>(null);

  useEffect(() => { if (server) setDraft(toDraft(server)); }, [server]);

  const dirty = draft !== null && server !== undefined && JSON.stringify(draft) !== JSON.stringify(toDraft(server));
  const reset = () => { if (server) setDraft(toDraft(server)); };

  return { draft, setDraft, dirty, reset };
}
