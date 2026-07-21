import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { useFeatureEnabled } from "./features";

/** The whole `/api/defs/*` surface is the (default-off) `defImporter` feature module — the router is only
 *  mounted when it's on. Read hooks gate their fetch on it so a features-off instance (e.g. a bare demo)
 *  doesn't 404-spam the console for defs it can't have. Cached defs still read back; only fetching is gated. */
export function useDefImporterEnabled(): boolean {
  // Fail-closed-while-loading fetch gate (see useFeatureEnabled): don't fire the `/api/defs/*` request
  // during the features-loading window, or it 404-spams the console on a features-off instance.
  return useFeatureEnabled("defImporter");
}

/**
 * Definition importer client hooks over `/api/defs/*` (roadmap X.3). THE single validated write-path for any
 * user-defined JSON definition into the scoped encrypted stores: the author picks a storage target — `user`
 * (their private area), `project`, or `org` — and the server validates by kind + gates the target before the
 * AES-256-GCM sealed write. Read viewer+, author/delete contributor+, org target manager+. Behind the
 * default-off `defImporter` module.
 */

export type DefKind = "primitive" | "screen" | "form" | "report" | "dashboard" | "businessRule" | "methodology" | "mapping" | "customField" | "theme" | "font" | "jsonDef";
export const DEF_KINDS: readonly DefKind[] = ["primitive", "screen", "form", "report", "dashboard", "businessRule", "methodology", "mapping", "customField", "theme", "font", "jsonDef"];
export type DefStorage = "user" | "project" | "programme" | "org";

export interface StoredDefMeta {
  id: string; kind: DefKind; name: string; storage: string;
  createdBy: string | null; createdAt: string; updatedAt: string;
}
export interface StoredDef extends StoredDefMeta { payload: unknown; rowVersion: number }

export interface ImportRequest {
  kind: DefKind; storage: DefStorage; projectId?: string; programmeId?: string; name: string; payload: unknown;
}

export const defsKey = ["defs"] as const;
export const defKey = (id: string) => ["def", id] as const;

/** One stored def with its payload (for the editor). */
export function useDef(id: string | undefined) {
  const importerOn = useDefImporterEnabled();
  return useQuery({
    queryKey: defKey(id ?? ""),
    queryFn: () => getJson<StoredDef>(`/api/defs/${encodeURIComponent(id!)}`),
    enabled: !!id && importerOn,
    staleTime: 5_000,
  });
}

/** The stored defs the caller can reach (payload omitted). */
export function useDefs(kind?: DefKind, projectId?: string) {
  const qs = new URLSearchParams();
  if (kind) qs.set("kind", kind);
  if (projectId) qs.set("projectId", projectId);
  const suffix = qs.toString();
  const enabled = useDefImporterEnabled();
  return useQuery({
    queryKey: [...defsKey, kind ?? null, projectId ?? null] as const,
    queryFn: () => getJson<StoredDefMeta[]>(`/api/defs${suffix ? `?${suffix}` : ""}`),
    enabled,
    staleTime: 15_000,
  });
}

/** The stored defs of ONE kind WITH their payloads, scope-aggregated — the read seam a renderer consumes to
 *  render user-authored defs from the unified importer store (roadmap X.10). Typed by the payload shape `T`. */
export function useResolvedDefs<T = unknown>(kind: DefKind, projectId?: string, programmeId?: string, enabled = true) {
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  if (programmeId) qs.set("programmeId", programmeId);
  const suffix = qs.toString();
  const enabled = useDefImporterEnabled();
  return useQuery({
    queryKey: [...defsKey, "resolved", kind, projectId ?? null, programmeId ?? null] as const,
    queryFn: () => getJson<Array<StoredDef & { payload: T }>>(`/api/defs/resolved/${encodeURIComponent(kind)}${suffix ? `?${suffix}` : ""}`),
    enabled,
    staleTime: 15_000,
  });
}

/** The binding slot key for a primitive family — namespaced so a primitive selection never collides with a
 *  same-named screen/report slot. Mirrors the server's `primitiveSlot` (lib/def-binding). Locking this slot at a
 *  scope mandates the primitive down that subtree (a descendant can't re-fork or re-select it). */
export function primitiveSlot(primitiveId: string): string {
  return `primitive:${primitiveId}`;
}

/** A stored selection for one slot (mirrors the server's `DefBinding`): the chosen def + whether the choice is
 *  LOCKED so lower scopes can't override it. */
export interface DefBinding { defId: string; locked?: boolean }

/** The winning selection for one slot (mirrors the server's def-binding `ResolvedBinding`). `defId: null`
 *  means no binding — the renderer falls back to the shipped system default. `source`/`locked` drive the UI
 *  (e.g. show a lock badge, or "org default"). */
export interface ResolvedBinding {
  defId: string | null;
  locked: boolean;
  lockedBy?: "org" | "programme" | "project";
  source: "org" | "programme" | "project" | "user" | "default";
}

/** The ACTIVE (winning) selection per slot for the caller's scope (roadmap X.12 slice 3). Resolution — lock
 *  precedence + most-specific-unlocked — is computed SERVER-SIDE, so the winner logic lives in one place; a
 *  renderer maps its slot → the winning `defId`, then reads the payload from {@link useResolvedDefs}. Pass the
 *  active project's id (and its programme id, if it belongs to one — the tier is opt-in) to consult those
 *  layers. */
export function useActiveDefs(projectId?: string, programmeId?: string) {
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  if (programmeId) qs.set("programmeId", programmeId);
  const suffix = qs.toString();
  const enabled = useDefImporterEnabled();
  return useQuery({
    queryKey: [...defsKey, "active", projectId ?? null, programmeId ?? null] as const,
    queryFn: () => getJson<Record<string, ResolvedBinding>>(`/api/defs/active${suffix ? `?${suffix}` : ""}`),
    enabled,
    staleTime: 15_000,
  });
}

/** Pick the winning def for `slot` from the resolved list + the active-binding map: the def whose id the
 *  binding selected, or `null` when there's no binding / the selected id isn't visible (→ system default).
 *  Pure, so a renderer can call it without another fetch. */
export function pickActiveDef<T = unknown>(
  resolved: ReadonlyArray<StoredDef & { payload: T }> | undefined,
  active: Record<string, ResolvedBinding> | undefined,
  slot: string,
): (StoredDef & { payload: T }) | null {
  const defId = active?.[slot]?.defId;
  if (!defId || !Array.isArray(resolved)) return null;
  return resolved.find((d) => d.id === defId) ?? null;
}

/** Dry-run: validate a payload by kind without writing. */
export function useValidateDef() {
  return useMutation({
    mutationFn: (input: { kind: DefKind; payload: unknown }) =>
      sendJson<{ valid: boolean; errors: string[] }>("/api/defs/validate", input, "POST"),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: defsKey });
}

/** Import a validated def into the chosen scoped store. */
export function useImportDef() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ImportRequest) => sendJson<StoredDef>("/api/defs", input, "POST"),
    onSuccess: invalidate,
  });
}

/** Edit an existing def in place (the kind is fixed server-side). */
export function useUpdateDef() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, name, payload }: { id: string; name?: string; payload: unknown }) =>
      sendJson<StoredDef>(`/api/defs/${encodeURIComponent(id)}`, { ...(name ? { name } : {}), payload }, "PUT"),
    onSuccess: invalidate,
  });
}

/** Delete a stored def. */
export function useDeleteDef() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => sendJson<void>(`/api/defs/${encodeURIComponent(id)}`, undefined, "DELETE"),
    onSuccess: invalidate,
  });
}
