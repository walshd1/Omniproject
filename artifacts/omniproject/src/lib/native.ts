import { useQuery, useMutation } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { useFeatures, featureEnabled } from "./features";

/**
 * Native handoff (companion-app bridge) client hooks over `/api/native/*` (roadmap X.1). Read the native
 * surfaces a connected backend fronts, mint a vetted (host-allowlisted) vendor handoff URL, and bring the
 * artifact back through the broker as a reference attachment. Behind the default-off `nativeHandoff` module
 * (the surfaces query 404s → no affordance — when it's off).
 */

export type NativeSurfaceKind =
  | "whiteboard" | "document" | "diagram" | "sheet" | "board"
  | "schedule" | "dashboard" | "report" | "form" | "wiki";

export interface NativeSurface {
  kind: NativeSurfaceKind;
  vendor: string;
  label: string;
  actions: Array<"open" | "create" | "embed">;
  importMode: "reference" | "content" | "screenshot";
}
export interface NativeContextRef { projectId?: string; issueId?: string; entity?: string; id?: string }
export interface NativeHandoff { url: string; embedUrl?: string; handoffId: string }

export const nativeSurfacesKey = ["native-surfaces"] as const;

/** The native surfaces connected backends front (empty / 404 when the module is off or nothing advertises).
 *  Gated on the (default-off) `nativeHandoff` module — its router only mounts when the feature is on, so a
 *  features-off instance would otherwise 404-spam the console for surfaces it can't have. */
export function useNativeSurfaces() {
  const enabled = featureEnabled(useFeatures().data, "nativeHandoff");
  return useQuery({ queryKey: nativeSurfacesKey, queryFn: () => getJson<NativeSurface[]>("/api/native/surfaces"), enabled, retry: false, staleTime: 60_000 });
}

/** Mint a handoff URL for a vendor surface. */
export function useNativeHandoff() {
  return useMutation({
    mutationFn: (req: { kind: NativeSurfaceKind; vendor: string; action: "open" | "create" | "embed"; contextRef?: NativeContextRef; externalRef?: string }) =>
      sendJson<NativeHandoff>("/api/native/handoff", req, "POST"),
  });
}

/** Bring the native artifact back as a reference attachment on the anchoring work item. */
export function useNativeImport() {
  return useMutation({
    mutationFn: (req: { kind: NativeSurfaceKind; vendor: string; handoffId?: string; externalRef?: string; target: { projectId: string; issueId?: string } }) =>
      sendJson<{ filename: string; url: string | null }>("/api/native/import", req, "POST"),
  });
}
