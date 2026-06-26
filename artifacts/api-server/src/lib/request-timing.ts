import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request timing accumulator. Carried through the async chain so the broker
 * can add the time it spent waiting on the upstream (n8n + backend), and a
 * middleware can emit it as a response header — letting an operator/the load
 * harness separate gateway/Express overhead from the real broker round-trip.
 *
 * Off-path safe: `addUpstreamMs` outside a request context is a no-op, so the
 * demo broker and unit tests don't need the middleware.
 */
interface Timing {
  upstreamMs: number;
}

const als = new AsyncLocalStorage<Timing>();

/** Run `fn` (and everything it awaits) inside a fresh timing context. */
export function runWithTiming<T>(fn: () => T): T {
  return als.run({ upstreamMs: 0 }, fn);
}

/** Add upstream wait time to the current request (no-op outside a context). */
export function addUpstreamMs(ms: number): void {
  const t = als.getStore();
  if (t && Number.isFinite(ms) && ms > 0) t.upstreamMs += ms;
}

/** Total upstream wait accumulated so far for the current request (0 if none). */
export function getUpstreamMs(): number {
  return als.getStore()?.upstreamMs ?? 0;
}
