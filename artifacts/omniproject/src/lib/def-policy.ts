import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { roleAtLeast, isPmoOrAdmin, type Role } from "./auth";
import type { DefStorage } from "./defs";

/**
 * Admin client for the definition-importer's per-scope WRITE policy over `/api/defs/policy` (roadmap X.5).
 * Who may write a definition at each scope — the per-user area, a project, or org-wide. Read is viewer+; the
 * change is admin-only. Lives behind the default-off `defImporter` module (so the GET 404s when it's off).
 */

export type DefGate = "contributor" | "manager" | "pmoOrAdmin" | "admin";
export interface DefScopePolicy { user: DefGate; project: DefGate; org: DefGate }
export interface DefPolicyState { policy: DefScopePolicy; gates: DefGate[] }

export const defPolicyKey = ["defs", "policy"] as const;

/** The current per-scope write policy + the allowed gate values. */
export function useDefPolicy() {
  return useQuery({ queryKey: defPolicyKey, queryFn: () => getJson<DefPolicyState>("/api/defs/policy"), retry: false, staleTime: 30_000 });
}

/** Change who may write at one or more scopes (admin). */
export function saveDefPolicy(patch: Partial<DefScopePolicy>) {
  return sendJson<{ policy: DefScopePolicy }>("/api/defs/policy", patch, "PUT");
}

/** Whether `role` clears a scope's write gate — mirrors the server's def-policy check, so the UI only offers a
 *  storage target the caller can actually write (the server stays authoritative). */
export function canWriteDefScope(role: Role | undefined, gate: DefGate): boolean {
  switch (gate) {
    case "contributor": return roleAtLeast(role, "contributor");
    case "manager": return roleAtLeast(role, "manager");
    case "pmoOrAdmin": return isPmoOrAdmin(role);
    case "admin": return role === "admin";
    default: return false;
  }
}

/** The scopes `role` may write, given the policy (falls back to the defaults when the policy isn't loaded). */
export function writableDefScopes(role: Role | undefined, policy: DefScopePolicy | undefined): DefStorage[] {
  const p = policy ?? { user: "contributor", project: "manager", org: "pmoOrAdmin" };
  return (["user", "project", "org"] as DefStorage[]).filter((s) => canWriteDefScope(role, p[s]));
}
