import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

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
