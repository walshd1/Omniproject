/** Push onto a bounded, in-memory ring (oldest evicted once `max` is exceeded) — the shared
 *  shape behind every RAM-only "recent N events" list (the broker log, health-watch findings,
 *  …): memory-safe by construction, nothing persisted, gone on restart. */
export function pushBounded<T>(ring: T[], item: T, max: number): void {
  ring.push(item);
  if (ring.length > max) ring.shift();
}
