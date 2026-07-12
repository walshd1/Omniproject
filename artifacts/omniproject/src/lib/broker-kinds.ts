import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { fetchBrokers, type BrokerInfo } from "./setup";

export const brokerKindsQueryKey = ["broker-kinds"] as const;

/** The admin-managed extra connected broker kinds. */
export function useBrokerKinds() {
  return useQuery({
    queryKey: brokerKindsQueryKey,
    queryFn: () => getJson<{ brokerKinds?: string[] }>("/api/broker-kinds").then((r) => r.brokerKinds ?? []),
    staleTime: 0,
  });
}

/** Persist the broker list (admin). The server re-validates each id against the catalogue. */
export function useSaveBrokerKinds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kinds: string[]) => sendJson("/api/broker-kinds", { brokerKinds: kinds }, "PUT", "Failed to save brokers"),
    onSuccess: () => qc.invalidateQueries({ queryKey: brokerKindsQueryKey }),
  });
}

/** The broker kinds the catalogue knows about (for the picker + client-side validity feedback). */
export function useAvailableBrokers(enabled: boolean) {
  return useQuery<BrokerInfo[]>({ queryKey: ["setup", "brokers"], queryFn: fetchBrokers, enabled, staleTime: 60_000 });
}
