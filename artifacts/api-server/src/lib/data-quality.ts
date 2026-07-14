import type { Request, Response, NextFunction } from "express";
import { withDataQualityScope, currentDataQuality } from "../broker/sanitizer";

/**
 * Data-quality surfacing middleware. Runs each request inside a fresh sanitizer tally scope, then — if
 * the broker sanitizer repaired any PRESENT-but-invalid field while serving this response — emits the
 * count as a response header. It's the operator/UI-facing half of the read seam: the sanitizer keeps
 * malformed backend data OUT of derivations (fail-soft repair), and this reports HOW MUCH had to be
 * repaired, so a backend quietly feeding dirty data is visible rather than silently smoothed over.
 *
 * The header is set by wrapping `res.json` (the API responders all use it) so it lands just before the
 * body is written, when the tally for this request is final. Non-JSON responses simply carry no header.
 */
export const DATA_QUALITY_HEADER = "X-OmniProject-Data-Repaired";

export function dataQualityMiddleware(_req: Request, res: Response, next: NextFunction): void {
  withDataQualityScope(() => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      const q = currentDataQuality();
      if (q && q.repaired > 0 && !res.headersSent) res.setHeader(DATA_QUALITY_HEADER, String(q.repaired));
      return originalJson(body);
    };
    next();
  });
}
