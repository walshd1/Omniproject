import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { DEPENDENCY_SCHEMA, type DependencyEdge, type DependencyType } from "./dependencies";

/**
 * Durable dependency edges (roadmap §5.5) — NOT a bespoke entity. A dependency edge is a row in the generic
 * `dependencies` mapping slot, read/written/deleted through the SAME generic mapping + sidecar surface every
 * other slot uses (`/mapping/dependencies/rows`, `PUT`/`DELETE /mapping/dependencies/:rowId`). The slot ships a
 * CORE mapping (fields homed on the built-in sidecar) so it resolves out of the box; an admin can remap any
 * field to a backend's native link API. This is the durable sibling of the browser-volatile overlay in
 * `lib/dependencies`: those live only in the session and export to a file; THESE survive a reload and drive
 * live critical-path, the forecast, and the Gantt cascade.
 *
 * We adapt each row into the SAME `DependencyEdge` shape the schedulers already consume, so no consumer
 * signature changes; the durable rows and the volatile overlay simply merge.
 */

const SLOT = "dependencies";

/** A durable edge as a generic slot row: two work-item ids within ONE project + a kind. No content. */
export interface DependencyRow {
  id?: string;
  fromId: string;
  toId: string;
  kind: DependencyType;
  note?: string;
}

/** The composite row id that keeps an edge idempotent on from·kind·to (the generic slot's join key). */
export function dependencyRowId(fromId: string, kind: DependencyType, toId: string): string {
  return `${fromId}__${kind}__${toId}`;
}

export function projectDependenciesQueryKey(projectId: string) {
  return ["mapping-rows", SLOT, projectId] as const;
}

/**
 * Adapt generic `dependencies` rows into the `DependencyEdge` shape the schedulers consume. Both endpoints are
 * items in THIS project, so `projectRef` is `projectId` on each side and `itemRef` is the id. The hashes /
 * assertedAt a volatile edge carries for drift don't apply to a durable row, so they're deterministic
 * placeholders — the schedulers only read `from/to.projectRef/itemRef` + `type`.
 */
export function rowsToScheduleEdges(
  rows: readonly DependencyRow[],
  projectId: string,
  system = "dependencies",
): DependencyEdge[] {
  return rows
    .filter((r) => r && r.fromId && r.toId && r.kind)
    .map((r) => ({
      schema: DEPENDENCY_SCHEMA,
      edgeKey: r.id ?? dependencyRowId(r.fromId, r.kind, r.toId),
      from: { system, projectRef: projectId, itemRef: r.fromId },
      to: { system, projectRef: projectId, itemRef: r.toId },
      type: r.kind,
      fromHash: "",
      toHash: "",
      assertedAt: new Date(0).toISOString(),
      ...(r.note ? { note: r.note } : {}),
    }));
}

/** The durable edges for a project, adapted to `DependencyEdge[]`. Returns `[]` (never throws) when the slot
 *  has no rows / store off / any read error, so a consumer can merge it unconditionally. */
export function useProjectDependencies(projectId: string | undefined, system = "dependencies") {
  return useQuery({
    queryKey: projectDependenciesQueryKey(projectId ?? ""),
    queryFn: () => getJson<{ rows: DependencyRow[] }>(`/api/projects/${encodeURIComponent(projectId!)}/mapping/${SLOT}/rows`),
    enabled: !!projectId,
    retry: false,
    select: (d) => rowsToScheduleEdges(d.rows ?? [], projectId!, system),
  });
}

/** Persist a durable edge through the generic mapping write (contributor+). Idempotent on the composite row id;
 *  invalidates the read. */
export function useWriteProjectDependency(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edge: { fromId: string; toId: string; kind: DependencyType; note?: string }) => {
      const rowId = dependencyRowId(edge.fromId, edge.kind, edge.toId);
      const fields: Record<string, string> = { fromId: edge.fromId, toId: edge.toId, kind: edge.kind, ...(edge.note ? { note: edge.note } : {}) };
      return sendJson(`/api/projects/${encodeURIComponent(projectId)}/mapping/${SLOT}/${encodeURIComponent(rowId)}`, { fields }, "PUT", "Could not save the dependency");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) }); },
  });
}

/** Remove a durable edge (contributor+) by its composite row id. Invalidates the read. */
export function useRemoveProjectDependency(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edge: { fromId: string; toId: string; kind: DependencyType }) => {
      const rowId = dependencyRowId(edge.fromId, edge.kind, edge.toId);
      return sendJson<void>(`/api/projects/${encodeURIComponent(projectId)}/mapping/${SLOT}/${encodeURIComponent(rowId)}`, undefined, "DELETE", "Could not remove the dependency");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) }); },
  });
}
