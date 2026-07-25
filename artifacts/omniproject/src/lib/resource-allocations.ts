import { configResource } from "./config-resource";

/**
 * Resource-allocations client. An allocation books a named person onto a project for a number of hours
 * over a period, stored as shared config via /api/resource-allocations (the planning/write side of
 * resourcing). Reads are open; writes are gated to `manager` server-side. The Resource-planning SCREEN
 * renders the roll-ups (/api/resource-allocations/rows) generically; this client backs the Settings admin
 * editor that owns the CONTENT.
 */
export interface ResourceAllocation {
  id: string;
  resource: string;
  projectId: string;
  hours: number;
  periodStart: string;
  periodEnd: string;
}

export const resourceAllocationsQueryKey = ["resource-allocations"] as const;

const resource = configResource<ResourceAllocation[]>({
  queryKey: resourceAllocationsQueryKey,
  path: "/api/resource-allocations",
  envelopeKey: "resourceAllocations",
  empty: [],
  saveErrorMessage: "Failed to save resource allocations", // manager-gated server-side
  alsoInvalidate: [["panel-data"]], // the resource-planning screen reads roll-ups under panel-data
});
export const useResourceAllocations = resource.useResource;
/** Persist the full allocations list (CSRF attached by the global fetch patch). Manager-gated server-side. */
export const useSaveResourceAllocations = resource.useSaveResource;
