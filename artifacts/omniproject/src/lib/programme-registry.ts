import { configResource } from "./config-resource";

/** A programme: an admin/PMO-chosen name + the project correlation GUIDs that belong to it. */
export interface ProgrammeDef {
  name: string;
  instanceIds: string[];
}
export type ProgrammeRegistry = Record<string, ProgrammeDef>;

export const programmeRegistryQueryKey = ["programme-registry"] as const;

const resource = configResource<ProgrammeRegistry>({
  queryKey: programmeRegistryQueryKey,
  path: "/api/programme-registry",
  envelopeKey: "programmeRegistry",
  empty: {},
  staleTime: 0,
  saveErrorMessage: "Failed to save programmes", // server re-validates shape (PMO and above)
});
export const useProgrammeRegistry = resource.useResource;
/** Persist the registry (PMO and above). The server re-validates shape. */
export const useSaveProgrammeRegistry = resource.useSaveResource;

/** Every project GUID that belongs to ANY programme — used to tell members from standalone projects. */
export function memberInstanceIds(registry: ProgrammeRegistry | undefined): Set<string> {
  const set = new Set<string>();
  for (const def of Object.values(registry ?? {})) for (const id of def.instanceIds) set.add(id);
  return set;
}
