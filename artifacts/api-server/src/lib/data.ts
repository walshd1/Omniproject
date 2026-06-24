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

export const getProjects = (req: Request) => getBroker().listProjects(contextFromReq(req));
export const getIssues = (req: Request, projectId: string) => getBroker().listIssues(contextFromReq(req), projectId);
export const getActivity = (req: Request) => getBroker().listActivity(contextFromReq(req));
export const getSummary = (req: Request, projectId: string) => getBroker().projectSummary(contextFromReq(req), projectId);
export const getHistory = (req: Request, projectId: string) => getBroker().projectHistory(contextFromReq(req), projectId);
export const getBaseline = (req: Request, projectId: string) => getBroker().baseline(contextFromReq(req), projectId);
export const getRaid = (req: Request, projectId: string) => getBroker().listRaid(contextFromReq(req), projectId);
export const getNotifications = (req: Request) => getBroker().notifications(contextFromReq(req));
