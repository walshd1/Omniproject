import { getArtifact, putArtifact, artifactStoreEnabled, type ArtifactScope } from "./artifact-store";
import { isForbiddenKey } from "./safe-json";
import type { DependencyLink, DependencyKind } from "../broker/types";

/**
 * SIDECAR DEPENDENCY store (roadmap §5.5, slice 2 — the sidecar fallback) — OmniProject's OWN zero-at-rest home
 * for the dependency graph when the backend broker fronts no native link API. Directed edges (from→to, with a
 * kind) live HERE — a project-scoped, AES-256-GCM sealed edge set, the same sealing as every def. Only id→id
 * relationships are stored, never item content, so the zero-at-rest posture holds even for the built-in home.
 *
 * The route prefers the broker's own `listDependencies`/`writeDependency`/`removeDependency`; this store is the
 * fallback the built-in broker uses when those capabilities are absent, so a backend that can't model links
 * (or the pure self-hosted all-in-one) still gets durable, brokered edges.
 */

export const DEPENDENCY_SIDECAR_ARTIFACT = "dependency-sidecar";
const EDGES_ID = "edges";

interface StoredDependencies { id: string; edges: DependencyLink[] }

const projectScope = (projectId: string): ArtifactScope => ({ kind: "project", projectId });

const sameEdge = (e: DependencyLink, fromId: string, toId: string, kind: DependencyKind): boolean =>
  e.fromId === fromId && e.toId === toId && e.kind === kind;

/** Clean an edge before sealing (defence in depth) — only the four known id→id/kind fields survive, and a
 *  forbidden note key is dropped. `note` is carried only when it is a non-empty string. */
function cleanEdge(edge: DependencyLink): DependencyLink {
  const out: DependencyLink = { fromId: edge.fromId, toId: edge.toId, kind: edge.kind };
  if (typeof edge.note === "string" && edge.note && !isForbiddenKey("note")) out.note = edge.note;
  return out;
}

/** The sidecar dependency edges for a project (empty when unset / store off). */
export function getSidecarDependencies(projectId: string): DependencyLink[] {
  if (!artifactStoreEnabled()) return [];
  return getArtifact<StoredDependencies>(DEPENDENCY_SIDECAR_ARTIFACT, projectScope(projectId), EDGES_ID)?.edges ?? [];
}

/** Whether a project has any authored sidecar edges (⇒ the graph reads the sidecar, not an external broker). */
export function hasSidecarDependencies(projectId: string): boolean {
  return getSidecarDependencies(projectId).length > 0;
}

/** Replace the whole edge set for a project. Edges are cleaned before sealing. */
export function setSidecarDependencies(projectId: string, edges: DependencyLink[]): DependencyLink[] {
  const clean = edges.filter((e) => e && typeof e === "object" && e.fromId && e.toId && e.kind).map(cleanEdge);
  putArtifact<StoredDependencies>(DEPENDENCY_SIDECAR_ARTIFACT, projectScope(projectId), { id: EDGES_ID, edges: clean });
  return clean;
}

/**
 * Upsert one edge, idempotent on from·kind·to (the same triple never duplicates — re-asserting just refreshes
 * the note). Returns the stored edge. Throws on an empty id.
 */
export function upsertSidecarDependency(projectId: string, link: DependencyLink): DependencyLink {
  if (!link.fromId || !link.toId) throw new Error("a sidecar dependency needs non-empty from/to ids");
  const edges = [...getSidecarDependencies(projectId)];
  const clean = cleanEdge(link);
  const idx = edges.findIndex((e) => sameEdge(e, link.fromId, link.toId, link.kind));
  if (idx >= 0) edges[idx] = clean;
  else edges.push(clean);
  setSidecarDependencies(projectId, edges);
  return clean;
}

/** Remove one edge by its from·kind·to triple (a no-op when absent). Returns the new edge set. */
export function removeSidecarDependency(projectId: string, fromId: string, toId: string, kind: DependencyKind): DependencyLink[] {
  const edges = getSidecarDependencies(projectId).filter((e) => !sameEdge(e, fromId, toId, kind));
  return setSidecarDependencies(projectId, edges);
}
