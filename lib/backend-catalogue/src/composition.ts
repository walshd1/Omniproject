/**
 * Methodology COMPOSITION enforcement — the shared primitive behind both the SPA's presentation filter and
 * the backend's runtime HARD GATE, so what a deployment can see and what the API will serve can never drift.
 * A composition is an explicit set of enabled `${kind}:${id}` artifact ids, or `null` = uncurated (all on).
 * PMO/admin-editable: a deployment can be as STRICT (curate to one methodology's set) or as RELAXED (null,
 * everything) as it likes. Pure, no deps.
 */

/** The saved composition: an explicit set of enabled `${kind}:${id}` ids, or `null` = uncurated (all visible). */
export type Composition = string[] | null;

/** Is a kind-namespaced id (e.g. `"report:evm"`) enabled under the composition? `null` ⇒ everything. */
export function isEnabledId(composition: Composition, namespacedId: string): boolean {
  return composition === null || composition.includes(namespacedId);
}

/** Is the artifact `${kind}:${id}` enabled? The runtime gate (`isComposed("report", "evm")`) and the
 *  presentation filter share this one predicate. `null` composition ⇒ everything. */
export function isComposed(composition: Composition, kind: string, id: string): boolean {
  return isEnabledId(composition, `${kind}:${id}`);
}

/** Keep only the items of one `kind` enabled under the composition (uncurated ⇒ all). */
export function filterComposed<T>(composition: Composition, kind: string, items: readonly T[], idOf: (t: T) => string): T[] {
  return composition === null ? [...items] : items.filter((t) => composition.includes(`${kind}:${idOf(t)}`));
}
