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
