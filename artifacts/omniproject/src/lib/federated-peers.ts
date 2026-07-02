import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Federated-peer registry client (backlog #135) — the other OmniProject instances this deployment
 * fans out to for a consolidated portfolio view (see FederatedPortfolio / lib/federation.ts on the
 * server). Config only (a base URL + a bearer credential per peer), never project data. Admin-gated
 * server-side; the token is masked on read (`tokenSet` instead) and a masked resubmit preserves the
 * real value — same shape as the webhooks admin panel, minus the reveal-once secret flow (the admin
 * TYPES the peer's token directly; it isn't generated here).
 */
export interface FederatedPeerRedacted {
  id: string;
  label: string;
  baseUrl: string;
  region: string | null;
  active: boolean;
  tokenSet: boolean;
}

/** A peer as edited in the admin form — `token` is blank/"********" when unchanged. */
export interface FederatedPeerDraft {
  id: string;
  label: string;
  baseUrl: string;
  token: string;
  region: string | null;
  active: boolean;
}

export const federatedPeersQueryKey = ["federated-peers"] as const;

/** The saved (token-redacted) peer list. */
export function useFederatedPeers() {
  return useQuery({
    queryKey: federatedPeersQueryKey,
    queryFn: () => getJson<{ peers: FederatedPeerRedacted[] }>("/api/federated-peers").then((r) => r.peers),
    staleTime: 30_000,
  });
}

/** Persist the full peer list (admin). A "********" token is left unchanged server-side. */
export function useSaveFederatedPeers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (peers: FederatedPeerDraft[]) => sendJson<{ peers: FederatedPeerRedacted[] }>("/api/federated-peers", { peers }),
    onSuccess: (data) => qc.setQueryData(federatedPeersQueryKey, data.peers),
  });
}
