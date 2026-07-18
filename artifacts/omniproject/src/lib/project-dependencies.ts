import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { DEPENDENCY_SCHEMA, type DependencyEdge, type DependencyType } from "./dependencies";

/**
 * Brokered (durable) dependency edges (roadmap §5.5 slice 3) — the server-side dependency graph a project's
 * backend fronts (a real SoR like Jira/ADO models these natively) or, when it fronts none, our sealed sidecar
 * (slice 2). This is the durable sibling of the browser-volatile overlay in `lib/dependencies`: those live only
 * in the session and export to a file; THESE round-trip through `GET/POST/DELETE /api/projects/:id/dependencies`
 * and survive a reload, so live critical-path, the forecast, and the Gantt cascade run on real precedence.
 *
 * Only id→id/kind crosses the seam (zero-at-rest) — the same discipline as the volatile overlay. We adapt each
 * brokered link into the SAME `DependencyEdge` shape the schedulers already consume so no consumer signature
 * changes; the two sources simply merge.
 */

/** A durable edge as the broker returns it: two work-item ids within ONE project + a kind. No content. */
export interface BrokeredDependency {
  fromId: string;
  toId: string;
  kind: DependencyType;
  note?: string;
}

export function projectDependenciesQueryKey(projectId: string) {
  return ["project-dependencies", projectId] as const;
}

/**
 * Adapt brokered links into the `DependencyEdge` shape the schedulers consume. Both endpoints are items in THIS
 * project, so `projectRef` is `projectId` on each side and `itemRef` is the id. The hashes/assertedAt a volatile
 * edge carries for drift detection don't apply to a durable SoR edge, so they're deterministic placeholders —
 * the schedulers only read `from/to.projectRef/itemRef` + `type` (see `dependencyEdgesToTyped`/`toCpmEdges`).
 */
export function brokeredToScheduleEdges(
  links: readonly BrokeredDependency[],
  projectId: string,
  system = "brokered",
): DependencyEdge[] {
  return links.map((l) => ({
    schema: DEPENDENCY_SCHEMA,
    edgeKey: `brokered:${l.fromId}:${l.kind}:${l.toId}`,
    from: { system, projectRef: projectId, itemRef: l.fromId },
    to: { system, projectRef: projectId, itemRef: l.toId },
    type: l.kind,
    fromHash: "",
    toHash: "",
    assertedAt: new Date(0).toISOString(),
    ...(l.note ? { note: l.note } : {}),
  }));
}

/** The durable edges for a project, adapted to `DependencyEdge[]`. Returns `[]` (never throws) when the backend
 *  fronts no graph and the sidecar is off, or on any read error, so a consumer can merge it unconditionally. */
export function useProjectDependencies(projectId: string | undefined, system = "brokered") {
  return useQuery({
    queryKey: projectDependenciesQueryKey(projectId ?? ""),
    queryFn: () => getJson<{ edges: BrokeredDependency[] }>(`/api/projects/${encodeURIComponent(projectId!)}/dependencies`),
    enabled: !!projectId,
    retry: false,
    select: (d) => brokeredToScheduleEdges(d.edges ?? [], projectId!, system),
  });
}

/** Persist a durable edge (contributor+). Idempotent on from·kind·to server-side; invalidates the read. */
export function useWriteProjectDependency(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (link: BrokeredDependency) =>
      sendJson<BrokeredDependency>(`/api/projects/${encodeURIComponent(projectId)}/dependencies`, link, "POST", "Could not save the dependency"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) }); },
  });
}

/** Remove a durable edge by its from·kind·to triple (contributor+). Invalidates the read. */
export function useRemoveProjectDependency(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (link: BrokeredDependency) =>
      sendJson<void>(`/api/projects/${encodeURIComponent(projectId)}/dependencies`, link, "DELETE", "Could not remove the dependency"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) }); },
  });
}
