import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import { stampSource } from "../broker/identity";
import { isProjectLive } from "../broker/vocabulary";
import type { Row } from "../broker/types";

/**
 * Data accessor facade. Historically this branched on backend-vs-demo inline; that
 * branching now lives behind the Broker seam (src/broker/*). These thin wrappers
 * keep the existing call sites (routes, exporter, OData, programmes) unchanged
 * while delegating every read to the active broker.
 */

export type { Row, Summary, HistoryPoint, Baseline } from "../broker/types";
export { getDemoState, persistDemoState } from "../broker/demo-data";

/** A cheap change token for a resource (for conditional/delta reads), or null when
 *  the active broker can't supply one (the caller falls back to a payload hash). */
export const brokerChangeToken = (req: Request, resource: string): Promise<string | null> => {
  const b = getBroker();
  return typeof b.changeToken === "function" ? b.changeToken(contextFromReq(req), resource) : Promise.resolve(null);
};

/** Keep only LIVE projects — drop those whose status is a closed lifecycle (completed/archived/
 *  cancelled). A project with no/unknown status stays (live-safe). See `isProjectLive`. */
export function liveProjectsOnly(rows: Row[]): Row[] {
  return rows.filter((r) => isProjectLive(typeof r["status"] === "string" ? (r["status"] as string) : undefined));
}

/** List the projects the actor can see, via the active broker. Each row is stamped with the broker's
 *  `source` if the backend omitted one, so the qualified identity (`source:id`) is always available.
 *  DEFAULT-LIVE: closed projects are filtered out unless `includeClosed` is set, so archived work never
 *  silently inflates portfolio / programme / financial roll-ups. */
export const getProjects = (req: Request, opts: { includeClosed?: boolean } = {}) => {
  const b = getBroker();
  return b.listProjects(contextFromReq(req)).then((rows) => {
    const stamped = stampSource(rows, b.kind);
    return opts.includeClosed ? stamped : liveProjectsOnly(stamped);
  });
};
/** List the issues of one project, via the active broker (source-stamped, as for projects). */
export const getIssues = (req: Request, projectId: string) => {
  const b = getBroker();
  return b.listIssues(contextFromReq(req), projectId).then((rows) => stampSource(rows, b.kind));
};
/** The cross-project activity feed, via the active broker. */
export const getActivity = (req: Request) => getBroker().listActivity(contextFromReq(req));
/** One project's roll-up summary (health/variance), via the active broker. */
export const getSummary = (req: Request, projectId: string) => getBroker().projectSummary(contextFromReq(req), projectId);
/** One project's historical points (for trends), via the active broker. */
export const getHistory = (req: Request, projectId: string) => getBroker().projectHistory(contextFromReq(req), projectId);
/** One project's baseline snapshot, via the active broker. */
export const getBaseline = (req: Request, projectId: string) => getBroker().baseline(contextFromReq(req), projectId);
/** One project's RAID log (risks/assumptions/issues/dependencies), via the active broker. */
export const getRaid = (req: Request, projectId: string) => getBroker().listRaid(contextFromReq(req), projectId);
/** The actor's notification feed, via the active broker. */
export const getNotifications = (req: Request) => getBroker().notifications(contextFromReq(req));
