import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ExtensionContributionKind, type ExtensionStatus } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "./api";
import { useFeatures, featureEnabled } from "./features";

export { EXTENSION_CONTRIBUTION_KINDS, contributionKindLabel, type ExtensionContributionKind, type ExtensionStatus } from "@workspace/backend-catalogue";

/**
 * Plugin marketplace client hooks over `/api/extensions/*` (roadmap 3.4). An installed extension is org-wide
 * config — a manifest of pure-JSON contributions. Browse is manager+; install/enable/remove is admin. Behind
 * the default-off `marketplace` feature module.
 */

export interface ExtensionContribution { id: string; kind: ExtensionContributionKind; name: string; def: unknown }
export interface ExtensionMeta {
  id: string; name: string; publisher: string; version: string; status: ExtensionStatus;
  contributionCount: number; contributionKinds: ExtensionContributionKind[]; installedAt: string; updatedAt: string;
}
export interface Extension extends ExtensionMeta { description: string | null; contributions: ExtensionContribution[]; installedBy: string | null; rowVersion: number }

export const extensionsKey = ["extensions"] as const;
export const extensionKey = (id: string) => ["extension", id] as const;

/** The installed extensions (contribution defs omitted). Gated on the (default-off) `marketplace` module —
 *  its router only mounts when the feature is on, so a features-off instance would otherwise 404-spam the
 *  console for extensions it can't have. */
export function useExtensions() {
  const enabled = featureEnabled(useFeatures().data, "marketplace");
  return useQuery({ queryKey: extensionsKey, queryFn: () => getJson<ExtensionMeta[]>("/api/extensions"), enabled, staleTime: 15_000 });
}

/** One installed extension with its contributions. */
export function useExtension(id: string | undefined) {
  const enabled = featureEnabled(useFeatures().data, "marketplace");
  return useQuery({ queryKey: extensionKey(id ?? ""), queryFn: () => getJson<Extension>(`/api/extensions/${encodeURIComponent(id!)}`), enabled: !!id && enabled, staleTime: 10_000 });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: extensionsKey });
}

/** Install an extension from a manifest object (admin). */
export function useInstallExtension() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (manifest: unknown) => sendJson<Extension>("/api/extensions", manifest, "POST"), onSuccess: invalidate });
}

/** Enable / disable an installed extension (admin). */
export function useSetExtensionStatus() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: ExtensionStatus }) => sendJson<Extension>(`/api/extensions/${encodeURIComponent(id)}/status`, { status }, "POST"), onSuccess: invalidate });
}

/** Uninstall an extension (admin). */
export function useUninstallExtension() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => sendJson<void>(`/api/extensions/${encodeURIComponent(id)}`, undefined, "DELETE"), onSuccess: invalidate });
}
