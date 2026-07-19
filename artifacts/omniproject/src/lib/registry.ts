import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  REGISTRY_ITEM_KINDS, registryItemKindLabel,
  type RegistryItemKind, type RegistryApprovalStatus, type RegistryVisibility,
} from "@workspace/backend-catalogue";
import { getJson, sendJson } from "./api";

export { REGISTRY_ITEM_KINDS, registryItemKindLabel };
export type { RegistryItemKind, RegistryApprovalStatus, RegistryVisibility };

/**
 * Org registry client hooks over `/api/registry/*` (roadmap 3.5). The registry is an org-wide store of
 * approved, pure-JSON building blocks (template / report / primitive / plugin / screen / dashboard / form /
 * jsonDef). Flow: submit (contributor+) → admin review (approve/reject) → optional release to the community.
 * Read is viewer+, but a non-admin sees only approved items + their own submissions. Behind the default-off
 * `registry` feature module.
 */

/** Where an approved primitive's def was activated — org-wide, or confined to one programme/project. */
export type ActivationScope =
  | { kind: "org" }
  | { kind: "programme"; programmeId: string }
  | { kind: "project"; projectId: string };

export interface RegistryItemMeta {
  id: string; kind: RegistryItemKind; name: string; publisher: string; version: string;
  approvalStatus: RegistryApprovalStatus; visibility: RegistryVisibility; tags: string[];
  submittedBy: string | null; submittedAt: string; updatedAt: string;
  activatedScope?: ActivationScope | null;
}
export interface RegistryItem extends RegistryItemMeta {
  description: string | null; payload: unknown;
  reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  releasedAt: string | null; communityRef: string | null; rowVersion: number;
}

export interface CommunityStatus { connected: boolean; name: string | null }

export const registryKey = ["registry"] as const;
export const registryItemKey = (id: string) => ["registry-item", id] as const;
export const communityStatusKey = ["registry-community-status"] as const;

/** The visible registry items (payload omitted). Non-admins see approved + their own. */
export function useRegistry() {
  return useQuery({ queryKey: registryKey, queryFn: () => getJson<RegistryItemMeta[]>("/api/registry"), staleTime: 15_000 });
}

/** One registry item with its payload. */
export function useRegistryItem(id: string | undefined) {
  return useQuery({ queryKey: registryItemKey(id ?? ""), queryFn: () => getJson<RegistryItem>(`/api/registry/${encodeURIComponent(id!)}`), enabled: !!id, staleTime: 10_000 });
}

/** Whether a community marketplace is connected. */
export function useCommunityStatus() {
  return useQuery({ queryKey: communityStatusKey, queryFn: () => getJson<CommunityStatus>("/api/registry/community/status"), staleTime: 60_000 });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: registryKey });
}

/** Submit an item for review (contributor+). */
export function useSubmitRegistryItem() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (submission: unknown) => sendJson<RegistryItem>("/api/registry", submission, "POST"), onSuccess: invalidate });
}

/** Approve or reject a submission (admin). Approving a PRIMITIVE may target a scope — org-wide (default), or
 *  CONFINED to a programme/project the approver holds (downward-only); the server gates the target. */
export function useReviewRegistryItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, decision, note, scope, programmeId, projectId }: {
      id: string; decision: "approved" | "rejected"; note?: string;
      scope?: "org" | "programme" | "project"; programmeId?: string; projectId?: string;
    }) => sendJson<RegistryItem>(`/api/registry/${encodeURIComponent(id)}/review`, {
      decision,
      ...(note ? { note } : {}),
      ...(scope && scope !== "org" ? { scope } : {}),
      ...(scope === "programme" && programmeId ? { programmeId } : {}),
      ...(scope === "project" && projectId ? { projectId } : {}),
    }, "POST"),
    onSuccess: invalidate,
  });
}

/** Release an approved item to the community (admin). */
export function useReleaseRegistryItem() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => sendJson<{ item: RegistryItem; published: boolean; reason?: string }>(`/api/registry/${encodeURIComponent(id)}/release`, {}, "POST"), onSuccess: invalidate });
}

/** Retract a released item back to internal-only (admin). */
export function useRetractRegistryItem() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => sendJson<RegistryItem>(`/api/registry/${encodeURIComponent(id)}/retract`, {}, "POST"), onSuccess: invalidate });
}

/** Delete an item (admin, or the submitter of a draft). */
export function useDeleteRegistryItem() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => sendJson<void>(`/api/registry/${encodeURIComponent(id)}`, undefined, "DELETE"), onSuccess: invalidate });
}
