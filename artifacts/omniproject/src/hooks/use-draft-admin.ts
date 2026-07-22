import { useEffect, useRef, useState } from "react";

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

  // Re-seed the draft ONLY when the server copy changes — never because `toDraft` got a new identity
  // (a caller passing an inline transform must not trigger an infinite re-seed loop). Hold the latest
  // transform in a ref so the effect always uses it while keeping `server` as its sole dependency.
  const toDraftRef = useRef(toDraft);
  toDraftRef.current = toDraft;
  // Call the transform as a PLAIN function, not via `toDraftRef.current(server)` — a member call sets
  // `this` to the ref object, and a native global cloner passed straight in (e.g. `structuredClone`) then
  // throws "Illegal invocation" because its `this` isn't the global. Binding it to a local fixes that.
  useEffect(() => { if (server) { const toDraft = toDraftRef.current; setDraft(toDraft(server)); } }, [server]);

  const dirty = draft !== null && server !== undefined && JSON.stringify(draft) !== JSON.stringify(toDraft(server));
  const reset = () => { if (server) setDraft(toDraft(server)); };

  return { draft, setDraft, dirty, reset };
}
