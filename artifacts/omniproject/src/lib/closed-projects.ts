import { configResource } from "./config-resource";

export const PROJECT_DISPOSITIONS = ["sor", "archive"] as const;
export type ProjectDisposition = (typeof PROJECT_DISPOSITIONS)[number];

/** Where a closed project's data lives, and where it closed. */
export interface ClosedProjectRecord {
  disposition: ProjectDisposition;
  source?: string;
  closedAt?: string;
  note?: string;
}
export type ClosedProjectRegistry = Record<string, ClosedProjectRecord>;

export const closedProjectsQueryKey = ["closed-projects"] as const;

const resource = configResource<ClosedProjectRegistry>({
  queryKey: closedProjectsQueryKey,
  path: "/api/closed-projects",
  envelopeKey: "closedProjects",
  empty: {},
  staleTime: 0,
  saveErrorMessage: "Failed to save closed projects", // server re-validates (PMO/admin)
});
export const useClosedProjects = resource.useResource;
/** Persist the closed-project registry (PMO/admin). The server re-validates. */
export const useSaveClosedProjects = resource.useSaveResource;
