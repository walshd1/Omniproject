/**
 * Optimistic-concurrency helper. The gateway (in demo mode) and any backend
 * that exposes a version token use the same rule: a write is stale when the
 * caller's expectedVersion is present and no longer matches the current one.
 */
export function versionConflict(expected: number | undefined, current: number): boolean {
  return typeof expected === "number" && expected !== current;
}
