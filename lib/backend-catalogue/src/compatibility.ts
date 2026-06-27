/**
 * Compatibility predicate — the single rule deciding whether a surfaceable asset
 * (report, screen, view, panel, …) should appear, given the resolved SUPPORT set.
 *
 * The support set is a flat `capability key → boolean` map: the union of the
 * connected backends' domains PLUS the connected broker(s)' capability keys. So a
 * report needing `financials` shows only when a backend feeds it; an event-driven
 * surface needing `eventsOutbound` shows only when a broker supports it — one
 * predicate, both planes. A `null`/absent requirement means "always available".
 */

/** True when an asset's (single) capability requirement is met by the support set. */
export function isCapabilityMet(requirement: string | null | undefined, support: Record<string, boolean>): boolean {
  return !requirement || support[requirement] === true;
}

/**
 * OR-union several support maps into one: a key is supported if ANY map marks it
 * `true`. This is how the resolver folds the backend domains and the broker
 * capability keys into ONE flat support set for `isCapabilityMet` — both planes,
 * one map. Only `=== true` values are copied, so a caller can pass a richer object
 * (e.g. the full resolved Capabilities, which also carries strings/objects) and
 * only its boolean capability flags are taken.
 */
export function unionSupport(...sets: Array<Record<string, unknown> | null | undefined>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const set of sets) {
    if (!set) continue;
    for (const k of Object.keys(set)) if (set[k] === true) out[k] = true;
  }
  return out;
}
