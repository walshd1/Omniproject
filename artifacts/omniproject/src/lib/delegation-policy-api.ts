import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { DelegationPolicy, DelegationArea, DelegationLevel } from "@workspace/backend-catalogue";

/**
 * Client read/write for the DELEGATION POLICY — the admin dial for how far down local variation is allowed
 * per governed area (ruleset / settings / methodology). Read is any authed user; write is PMO/admin.
 */
export const delegationPolicyKey = ["delegation-policy"] as const;

export interface DelegationPolicyResponse {
  policy: DelegationPolicy;
  areas: readonly DelegationArea[];
  levels: readonly DelegationLevel[];
}

export function useDelegationPolicy() {
  return useQuery({
    queryKey: delegationPolicyKey,
    queryFn: () => getJson<DelegationPolicyResponse>("/api/admin/delegation-policy"),
    staleTime: 30_000,
  });
}

export function useSetDelegationPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policy: DelegationPolicy) =>
      sendJson<{ policy: DelegationPolicy }>("/api/admin/delegation-policy", { policy }, "PUT", "Failed to save the delegation policy"),
    onSuccess: () => qc.invalidateQueries({ queryKey: delegationPolicyKey }),
  });
}
