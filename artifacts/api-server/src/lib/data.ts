import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";

/**
 * Data accessor facade. Historically this branched on backend-vs-demo inline; that
 * branching now lives behind the Broker seam (src/broker/*). These thin wrappers
 * keep the existing call sites (routes, exporter, OData, programmes) unchanged
 * while delegating every read to the active broker.
 */

export type { Row, Summary, HistoryPoint, Baseline } from "../broker/types";
export { getDemoState, persistDemoState } from "../broker/demo-data";

/** List all projects the actor can see, via the active broker. */
export const getProjects = (req: Request) => getBroker().listProjects(contextFromReq(req));
/** List the issues of one project, via the active broker. */
export const getIssues = (req: Request, projectId: string) => getBroker().listIssues(contextFromReq(req), projectId);
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
