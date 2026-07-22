import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Admin client for custom roles + permission sets over `/api/admin/custom-roles` (roadmap X.6). An admin
 * names their own roles (each grounded in a fixed base role) and permission bundles (named sets of governance
 * capabilities), and assigns IdP groups to them. Admin-only; the save is step-up gated. A custom role can
 * never exceed its base role.
 */

export interface CapabilityRef { id: string; label: string; kind: string }
export interface PermissionSet { id: string; label: string; description?: string; capabilities: string[] }
export interface CustomRole { id: string; label: string; description?: string; baseRole: string; permissionSetIds: string[]; groups: string[] }
export interface CustomRolesConfig { permissionSets: PermissionSet[]; customRoles: CustomRole[] }
export interface CustomRolesState {
  config: CustomRolesConfig;
  baseRoles: string[];
  roles: string[];
  capabilities: CapabilityRef[];
}

export const customRolesKey = ["admin", "custom-roles"] as const;

/** The current custom-roles config + the base-role and capability pickers the editor needs. */
export function useCustomRoles() {
  return useQuery({ queryKey: customRolesKey, queryFn: () => getJson<CustomRolesState>("/api/admin/custom-roles"), retry: false, staleTime: 30_000 });
}

/** Replace the whole custom-roles config (admin; step-up gated). */
export function saveCustomRoles(config: CustomRolesConfig) {
  return sendJson<{ config: CustomRolesConfig }>("/api/admin/custom-roles", config, "PUT");
}
