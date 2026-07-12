import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import { stampSource } from "../broker/identity";
import { isProjectLive } from "../broker/vocabulary";
import { getSettings } from "./settings";
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
 *  cancelled), AND drop any RETIRED GUID (a deleted project can't silently reactivate even if a backend
 *  re-serves it). A project with no/unknown status stays (live-safe). See `isProjectLive`. */
export function liveProjectsOnly(rows: Row[], retired: ReadonlySet<string> = new Set()): Row[] {
  return rows.filter((r) => {
    const guid = typeof r["omniInstanceId"] === "string" ? (r["omniInstanceId"] as string) : "";
    if (guid && retired.has(guid)) return false;
    return isProjectLive(typeof r["status"] === "string" ? (r["status"] as string) : undefined);
  });
}

/** List the projects the actor can see, via the active broker. Each row is stamped with the broker's
 *  `source` if the backend omitted one, so the qualified identity (`source:id`) is always available.
 *  DEFAULT-LIVE: closed projects are filtered out unless `includeClosed` is set, so archived work never
 *  silently inflates portfolio / programme / financial roll-ups. Retired (deleted) GUIDs are ALWAYS
 *  suppressed — even with `includeClosed` — so a forgotten project can't come back without a re-link. */
export const getProjects = (req: Request, opts: { includeClosed?: boolean } = {}) => {
  const b = getBroker();
  return b.listProjects(contextFromReq(req)).then((rows) => {
    const stamped = stampSource(rows, b.kind);
    // includeClosed shows everything — closed and retired projects are still viewable there. The default
    // LIVE view excludes both closed-status projects AND retired GUIDs: a retired project (closed OR
    // deleted) can't silently reactivate even if the backend re-serves it as active.
    return opts.includeClosed ? stamped : liveProjectsOnly(stamped, new Set(getSettings().retiredGuids));
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
