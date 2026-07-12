import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/** A programme: an admin/PMO-chosen name + the project correlation GUIDs that belong to it. */
export interface ProgrammeDef {
  name: string;
  instanceIds: string[];
}
export type ProgrammeRegistry = Record<string, ProgrammeDef>;

export const programmeRegistryQueryKey = ["programme-registry"] as const;

export function useProgrammeRegistry() {
  return useQuery({
    queryKey: programmeRegistryQueryKey,
    queryFn: () => getJson<{ programmeRegistry?: ProgrammeRegistry }>("/api/programme-registry").then((r) => r.programmeRegistry ?? {}),
    staleTime: 0,
  });
}

/** Persist the registry (PMO and above). The server re-validates shape. */
export function useSaveProgrammeRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registry: ProgrammeRegistry) => sendJson("/api/programme-registry", { programmeRegistry: registry }, "PUT", "Failed to save programmes"),
    onSuccess: () => qc.invalidateQueries({ queryKey: programmeRegistryQueryKey }),
  });
}

/** Every project GUID that belongs to ANY programme — used to tell members from standalone projects. */
export function memberInstanceIds(registry: ProgrammeRegistry | undefined): Set<string> {
  const set = new Set<string>();
  for (const def of Object.values(registry ?? {})) for (const id of def.instanceIds) set.add(id);
  return set;
}
