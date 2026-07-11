import { useRef } from "react";

/**
 * Stable React keys for an editable list whose persisted row model carries no id of its own
 * (rate-card project types / value columns, cost-rule predicates, …). The keys live ALONGSIDE the
 * data in a ref — never inside it — so they never reach the server and never trip the
 * `JSON.stringify(draft) === JSON.stringify(server)` dirty-check the settings drafts rely on
 * (see use-draft-admin). Keys track the list by position: appending a row (length grows) mints a
 * fresh key, so `key={keyAt(i)}` beats `key={i}` for add-at-end; removing row `i` must go through
 * `removeAt(i)` so the dropped row's key is removed and every surviving row keeps its own key
 * (index keys would shift child component state — an in-flight input buffer, focus — onto the
 * wrong row). A length shrink from elsewhere (a reset / server reseed) falls back to trimming the
 * tail, which at worst remounts rows once — fine for a wholesale reseed.
 */
export function useRowKeys(length: number): { keyAt: (i: number) => string; removeAt: (i: number) => void } {
  const keys = useRef<string[]>([]);
  while (keys.current.length < length) keys.current.push(crypto.randomUUID());
  if (keys.current.length > length) keys.current.length = length;
  return {
    keyAt: (i) => keys.current[i]!,
    removeAt: (i) => { keys.current.splice(i, 1); },
  };
}
