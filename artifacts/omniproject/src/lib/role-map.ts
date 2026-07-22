import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Admin role-map client (group → role mapping) over `/api/admin/role-map`. Lets an admin decide which IdP
 * groups/claims land in each FIXED OmniProject role — the editable form of the OIDC_*_ROLES env. It can only
 * assign groups to an existing role; it can never invent a role or a permission (the role set is fixed in
 * code). Admin-only; the PUT is step-up gated (and four-eyes when dual control is configured).
 */

export interface RoleMapEntry {
  role: string;
  claims: string[];
  source: "env" | "override";
}
export interface RoleMapState {
  roles: string[];
  mapping: RoleMapEntry[];
  rollbackAvailable: boolean;
}

export const roleMapKey = ["admin", "role-map"] as const;

/** The current group→role mapping (with each role's source: env baseline or an admin override). */
export function useRoleMap() {
  return useQuery({ queryKey: roleMapKey, queryFn: () => getJson<RoleMapState>("/api/admin/role-map"), staleTime: 30_000 });
}

/** Persist an admin override of the group lists (a `{ role: groups[] }` map of the claim-mappable roles). */
export function saveRoleMap(groupsByRole: Record<string, string[]>) {
  return sendJson<RoleMapState>("/api/admin/role-map", groupsByRole, "PUT");
}

/** One-generation undo of the last role-map change. */
export function rollbackRoleMap() {
  return sendJson<RoleMapState>("/api/admin/role-map/rollback", {}, "POST");
}

/** Split an edited group list (commas / newlines / spaces) into a clean, de-duped, lower-cased array. */
export function parseGroups(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const g = raw.trim().toLowerCase();
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}
