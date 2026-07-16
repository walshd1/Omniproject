import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Definition importer client hooks over `/api/defs/*` (roadmap X.3). THE single validated write-path for any
 * user-defined JSON definition into the scoped encrypted stores: the author picks a storage target — `user`
 * (their private area), `project`, or `org` — and the server validates by kind + gates the target before the
 * AES-256-GCM sealed write. Read viewer+, author/delete contributor+, org target manager+. Behind the
 * default-off `defImporter` module.
 */

export type DefKind = "primitive" | "screen" | "form" | "report" | "dashboard" | "jsonDef";
export const DEF_KINDS: readonly DefKind[] = ["primitive", "screen", "form", "report", "dashboard", "jsonDef"];
export type DefStorage = "user" | "project" | "org";

export interface StoredDefMeta {
  id: string; kind: DefKind; name: string; storage: string;
  createdBy: string | null; createdAt: string; updatedAt: string;
}
export interface StoredDef extends StoredDefMeta { payload: unknown; rowVersion: number }

export interface ImportRequest {
  kind: DefKind; storage: DefStorage; projectId?: string; name: string; payload: unknown;
}

export const defsKey = ["defs"] as const;

/** The stored defs the caller can reach (payload omitted). */
export function useDefs(kind?: DefKind, projectId?: string) {
  const qs = new URLSearchParams();
  if (kind) qs.set("kind", kind);
  if (projectId) qs.set("projectId", projectId);
  const suffix = qs.toString();
  return useQuery({
    queryKey: [...defsKey, kind ?? null, projectId ?? null] as const,
    queryFn: () => getJson<StoredDefMeta[]>(`/api/defs${suffix ? `?${suffix}` : ""}`),
    staleTime: 15_000,
  });
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

/** Delete a stored def. */
export function useDeleteDef() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => sendJson<void>(`/api/defs/${encodeURIComponent(id)}`, undefined, "DELETE"),
    onSuccess: invalidate,
  });
}
