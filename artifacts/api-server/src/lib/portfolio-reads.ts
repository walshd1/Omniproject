import type { Request } from "express";
import { getProjects, getIssues, type Row } from "./data";
import { poolMap } from "./concurrency-pool";

/**
 * Shared portfolio-wide issue fan-out — was duplicated verbatim (and unbounded) in both
 * routes/export.ts and routes/odata.ts: every xlsx/csv/json/md/pdf export and every OData
 * `/Issues` feed poll fired one `getIssues` call PER PROJECT via a bare `Promise.all`, which is a
 * 200-way concurrent hit on the backend at the 60/200-project target (Power BI/SAP feed polls make
 * this recur on every poll interval, not just on demand). Bounded here to a small pool so exports
 * and feeds stay well under the connection/rate-limit ceiling. See docs/PERF-PATTERNS-REVIEW.md,
 * Theme A + Theme F (the export path also used to fetch `getProjects` twice; callers now pass the
 * already-fetched list in).
 */
const ISSUES_FANOUT_LIMIT = 10;

/** Every issue across every project the actor can see. Pass an already-fetched `projects` list to
 *  avoid re-fetching it (the export.xlsx handler needs the project list anyway). */
export async function allIssues(req: Request, projects?: Row[]): Promise<Row[]> {
  const list = projects ?? (await getProjects(req));
  const lists = await poolMap(list, ISSUES_FANOUT_LIMIT, (p) => getIssues(req, String(p["id"])));
  return lists.flat();
}
