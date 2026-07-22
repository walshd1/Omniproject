/**
 * DEF COMPOSITION (the `extends` model, generalised beyond primitives) — a def is either a ROOT (built on
 * nothing) or a THIN child that `extends` a parent of the SAME kind and adds/alters properties
 * property-by-property (child wins). `composeExtends` walks the chain to a root and folds it, recording the
 * `lineage` so from any leaf you can trace every def it is built from. Reused by the report, screen and mapping
 * catalogues; primitives keep their own param-specific resolver.
 *
 * Merge algebra (root → leaf, child wins):
 *   - plain objects → deep-merge per key (so `capabilities`, a panel's `config`, … compose field-by-field);
 *   - arrays whose every element carries an `id`/`key` → merge by that key (child element overrides, new ones
 *     appended, order preserved) — this is how `panels[]` compose;
 *   - scalars and id-less arrays → the child's value replaces the parent's (a declared property wins whole).
 * A rootless def composes to ITSELF, so a def that never uses `extends` is unchanged.
 */

export interface Composable { id: string; extends?: string }

/** Walk the extends chain leaf → root. Throws on a cycle or a missing parent (fail-closed — a broken chain is a
 *  data error, never a silently-partial def). Empty when `id` is unknown. */
export function extendsLineage<T extends Composable>(id: string, byId: (k: string) => T | undefined): T[] {
  const chain: T[] = [];
  const seen = new Set<string>();
  let cur = byId(id);
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`def "${id}": extends cycle at "${cur.id}"`);
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.extends) break;
    const parent = byId(cur.extends);
    if (!parent) throw new Error(`def "${cur.id}": extends "${cur.extends}" which does not exist`);
    cur = parent;
  }
  return chain;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The merge key of an array element, when it has one (`id` then `key`). Undefined for scalars / keyless objects. */
function elementKey(el: unknown): string | undefined {
  if (!isPlainObject(el)) return undefined;
  const k = el["id"] ?? el["key"];
  return typeof k === "string" && k ? k : undefined;
}

/** Merge `child` onto `base` property-by-property, child wins. See the module header for the algebra. */
export function mergeValue(base: unknown, child: unknown): unknown {
  if (child === undefined) return base;
  if (isPlainObject(base) && isPlainObject(child)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(child)) out[k] = mergeValue(base[k], v);
    return out;
  }
  if (Array.isArray(base) && Array.isArray(child) && base.every((e) => elementKey(e) !== undefined) && child.every((e) => elementKey(e) !== undefined)) {
    const byKey = new Map<string, unknown>();
    for (const e of base) byKey.set(elementKey(e)!, e);
    for (const e of child) byKey.set(elementKey(e)!, mergeValue(byKey.get(elementKey(e)!), e));
    return [...byKey.values()];
  }
  return child; // scalar or id-less array — the child's declared value wins whole
}

/** A def with its extends chain executed + the lineage recorded (leaf → root). */
export type Resolved<T> = T & { lineage: string[] };

/**
 * Compose a def and its ancestors into the effective def — fold root → leaf so the leaf wins
 * property-by-property. Returns the flattened def plus `lineage`. Undefined when `id` is unknown. A rootless def
 * resolves to itself (+ a one-entry lineage), so non-`extends` defs are unchanged.
 */
export function composeExtends<T extends Composable>(id: string, byId: (k: string) => T | undefined): Resolved<T> | undefined {
  const chain = extendsLineage(id, byId);
  if (!chain.length) return undefined;
  let acc: Record<string, unknown> = {};
  for (let i = chain.length - 1; i >= 0; i--) acc = mergeValue(acc, chain[i]) as Record<string, unknown>;
  return { ...(acc as T), lineage: chain.map((d) => d.id) };
}
