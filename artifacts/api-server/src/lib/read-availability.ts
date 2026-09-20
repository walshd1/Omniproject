import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

/**
 * Read-availability tally — the "some sources didn't answer" half of the read seam, and the sibling of
 * `lib/data-quality.ts` (which reports malformed data that DID arrive). Same shape deliberately: a
 * per-request AsyncLocalStorage tally, surfaced on the response as a header.
 *
 * WHY IT EXISTS. OmniProject holds no copy of anything, so a portfolio view is a live fan-out and any
 * backend that fails takes its slice of the truth with it. Until now every fan-out went through
 * `poolMap`, built on `Promise.all`, so ONE failing project rejected the whole request: a single flaky
 * backend blanked the entire portfolio. That is safe (a wrong number is never shown) but useless — the
 * other three systems were answering fine.
 *
 * WHAT IT DOES NOT DO. It does not cache, persist, or serve last-known-good anything. There is nothing
 * at rest here and nothing survives the request; the tally only ever describes what answered RIGHT NOW.
 * A degraded read is still a live read.
 *
 * THE RULE THIS ENFORCES. Rows that answered are real and render normally. A figure DERIVED by summing
 * across sources (budget totals, RAG spread, capacity) is NOT reportable when a source is missing —
 * a total over 3 of 4 backends is not a smaller total, it is a wrong one, and screenshotted into a
 * board pack it reads as authoritative. Callers ask {@link readsWereComplete} before publishing an
 * aggregate and omit it when the answer is false. This is the same principle as the provenance badges:
 * a derived figure is never presented as backend fact.
 */

export interface UnavailableSource {
  /** What failed, in the caller's own domain vocabulary (a projectId, a backend key). Never a URL or
   *  a broker-specific identifier — this rides to the SPA and must stay above the seam. */
  source: string;
  /** A short, already-safe reason. Broker errors are summarised to their class by the caller; raw
   *  messages can carry backend hostnames or credentials, so they are never put here verbatim. */
  reason: string;
}

interface Tally {
  attempted: number;
  unavailable: UnavailableSource[];
}

const scope = new AsyncLocalStorage<Tally>();

export const AVAILABILITY_HEADER = "X-OmniProject-Sources-Unavailable";

/** Establish a fresh availability tally for the (possibly async) work `fn` starts — the request
 *  middleware entry point, mirroring `withDataQualityScope`. */
export function withAvailabilityScope(fn: () => void): void {
  scope.run({ attempted: 0, unavailable: [] }, fn);
}

/** The active tally, or undefined outside a scope (fan-outs still degrade; they just aren't counted). */
export function currentAvailability(): Readonly<Tally> | undefined {
  const t = scope.getStore();
  return t ? { attempted: t.attempted, unavailable: [...t.unavailable] } : undefined;
}

/** Count sources we tried to reach. Callers record this even when everything succeeds, so the tally can
 *  report "3 of 4" rather than only "1 failed". */
export function recordAttempted(count: number): void {
  const t = scope.getStore();
  if (t) t.attempted += count;
}

/** Record one source that did not answer. Deduplicated on `source`, because a single unreachable
 *  backend can fail many per-project reads in one fan-out and that is one outage, not twenty. */
export function recordUnavailable(source: string, reason: string): void {
  const t = scope.getStore();
  if (!t) return;
  if (t.unavailable.some((u) => u.source === source)) return;
  t.unavailable.push({ source, reason });
}

/**
 * Did every source this request touched answer? Callers gate any CROSS-SOURCE aggregate on this and
 * omit the figure when it is false. Outside a scope this returns true: a caller with no tally has no
 * evidence of a gap, and silently suppressing every total would be worse than the status quo.
 */
export function readsWereComplete(): boolean {
  const t = scope.getStore();
  return !t || t.unavailable.length === 0;
}

/** `{ complete, attempted, answered, unavailable }` for a response body — what the UI needs to say
 *  "3 of 4 sources reporting" and name the missing one. */
export function availabilityReport(): {
  complete: boolean; attempted: number; answered: number; unavailable: UnavailableSource[];
} {
  const t = scope.getStore();
  if (!t) return { complete: true, attempted: 0, answered: 0, unavailable: [] };
  return {
    complete: t.unavailable.length === 0,
    attempted: t.attempted,
    answered: Math.max(0, t.attempted - t.unavailable.length),
    unavailable: [...t.unavailable],
  };
}

/**
 * Surfacing middleware. Wraps `res.json` so the header lands with the body, once the tally for this
 * request is final — identical mechanics to `dataQualityMiddleware`. The value is the count of sources
 * that did not answer; absent when everything did.
 */
export function readAvailabilityMiddleware(_req: Request, res: Response, next: NextFunction): void {
  withAvailabilityScope(() => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      const a = scope.getStore();
      if (a && a.unavailable.length > 0 && !res.headersSent) {
        res.setHeader(AVAILABILITY_HEADER, String(a.unavailable.length));
      }
      return originalJson(body);
    };
    next();
  });
}
