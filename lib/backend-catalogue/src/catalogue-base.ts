/**
 * defineCatalogue — the read-side twin of the write-lane spines. Almost every backend catalogue consumes its
 * generated `<X>_DATA` array the same way: (optionally) sort by `order`, index by `id`, then expose a
 * by-id lookup + a defensive-copy list. That four-line ceremony was hand-rolled in ~15 modules; this captures
 * it once so a catalogue module carries only its OWN accessors (derived tables, scope-folding resolvers) on
 * top of a shared, consistent core.
 *
 * It owns only the core (sort → byId → get/list/has). Anything catalogue-specific stays in the module.
 */

export interface Catalogue<T> {
  /** All items in catalogue order (sorted by `order` when requested) — the shared array. */
  all: T[];
  /** The item ids, in catalogue order. */
  ids: string[];
  /** id → item. */
  byId: ReadonlyMap<string, T>;
  /** True when `id` is a shipped item. */
  has(id: string | null | undefined): boolean;
  /** One item by id, or undefined. */
  get(id: string): T | undefined;
  /** All items as a fresh array of shallow copies (safe to hand out). */
  list(): T[];
}

/**
 * Build a catalogue over a generated `_DATA` array. Items must carry a string `id`; pass `sortByOrder` when
 * they carry a numeric `order` and should present in that order (a stable, defensive sort on a copy — the
 * caller's array is never mutated). A duplicate id is a data error the generator should never emit; we keep
 * last-wins in the map (matching a hand-rolled `new Map(...)`) rather than throwing, so a catalogue can't be
 * bricked at import time.
 */
export function defineCatalogue<T extends { id: string; order?: number }>(
  data: readonly T[],
  opts: { sortByOrder?: boolean } = {},
): Catalogue<T> {
  const all = opts.sortByOrder
    ? [...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [...data];
  const byId = new Map<string, T>(all.map((x) => [x.id, x]));
  return {
    all,
    ids: all.map((x) => x.id),
    byId,
    has: (id) => id != null && byId.has(id),
    get: (id) => byId.get(id),
    list: () => all.map((x) => ({ ...x })),
  };
}
