import { useQuery } from "@tanstack/react-query";
import { fetchBrokers, type BrokerInfo } from "./setup";
import { configResource } from "./config-resource";

export const brokerKindsQueryKey = ["broker-kinds"] as const;

const resource = configResource<string[]>({
  queryKey: brokerKindsQueryKey,
  path: "/api/broker-kinds",
  envelopeKey: "brokerKinds",
  empty: [],
  staleTime: 0,
  // The server re-validates each id against the catalogue (admin).
  saveErrorMessage: "Failed to save brokers",
});
/** The admin-managed extra connected broker kinds. */
export const useBrokerKinds = resource.useResource;
/** Persist the broker list (admin). The server re-validates each id against the catalogue. */
export const useSaveBrokerKinds = resource.useSaveResource;

/** The broker kinds the catalogue knows about (for the picker + client-side validity feedback). */
export function useAvailableBrokers(enabled: boolean) {
  return useQuery<BrokerInfo[]>({ queryKey: ["setup", "brokers"], queryFn: fetchBrokers, enabled, staleTime: 60_000 });
}
