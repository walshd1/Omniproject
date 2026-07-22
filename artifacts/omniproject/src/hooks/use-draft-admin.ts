import { useEffect, useRef, useState } from "react";

/** Default clone step: a deep structural copy so a draft can be freely mutated without touching the server
 *  copy. A bound wrapper, NEVER the bare `structuredClone` global — a bare WebIDL global handed to a helper
 *  that re-invokes it as a member (`ref.current(x)`) gets the wrong `this` and throws "Illegal invocation"
 *  in the browser (the RACI screen crashed exactly this way). Callers that need a non-clone transform still
 *  pass their own `toDraft`. */
const identityClone = <T>(value: T): T => structuredClone(value);

/**
 * The seed-draft-from-server / dirty-check / reset pattern shared by every settings admin panel
 * (rate card, custom reports, content pages, priority weights, cost rules, governance rules,
 * federated peers, rate grid, …): a draft is staged locally, reseeded whenever the server copy
 * changes underneath it, and considered dirty when it no longer matches what `toDraft` would
 * produce from the current server value. `toDraft` doubles as the clone step and DEFAULTS to a bound
 * deep clone (see {@link identityClone}) — callers just omit it unless they need a real transform.
 */
export function useDraftAdmin<S, D = S>(server: S | undefined, toDraft?: (server: S) => D) {
  const [draft, setDraft] = useState<D | null>(null);
  const transform = toDraft ?? (identityClone as unknown as (server: S) => D);

  // Re-seed the draft ONLY when the server copy changes — never because `toDraft` got a new identity
  // (a caller passing an inline transform must not trigger an infinite re-seed loop). Hold the latest
  // transform in a ref so the effect always uses it while keeping `server` as its sole dependency.
  const toDraftRef = useRef(transform);
  toDraftRef.current = transform;
  // Call the transform as a PLAIN function, not via `toDraftRef.current(server)` — a member call sets
  // `this` to the ref object, and a native global cloner would then throw "Illegal invocation".
  useEffect(() => { if (server) { const seed = toDraftRef.current; setDraft(seed(server)); } }, [server]);

  const dirty = draft !== null && server !== undefined && JSON.stringify(draft) !== JSON.stringify(transform(server));
  const reset = () => { if (server) setDraft(transform(server)); };

  return { draft, setDraft, dirty, reset };
}
