import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";

/**
 * Per-collection EDIT-policy client. Maps a settings collection (e.g. "raci") to a minimum edit role, or
 * "readonly". Default (unset) = user-editable. Read as a slice of the shared /api/settings query; written by
 * admin/PMO via /api/collection-edit-roles. The RegisterPanel reads this to show/hide its edit controls, and
 * the server enforces it on the collection's write (lib/collection-edit-policy).
 */
export type EditPolicy = "viewer" | "contributor" | "manager" | "pmo" | "admin" | "readonly";
export type CollectionEditRoles = Record<string, EditPolicy>;

export function useCollectionEditRoles() {
  return useSettingsSlice((s) => (s["collectionEditRoles"] && typeof s["collectionEditRoles"] === "object" ? (s["collectionEditRoles"] as CollectionEditRoles) : {}));
}

export function useSaveCollectionEditRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (collectionEditRoles: CollectionEditRoles) => sendJson<unknown>("/api/collection-edit-roles", { collectionEditRoles }, "PUT", "Failed to save edit access"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}
