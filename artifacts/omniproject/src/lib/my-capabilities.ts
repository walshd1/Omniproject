import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * The governed capabilities enabled for the current user (finance areas, AI tools, vendors, …). A UX HINT the
 * SPA uses to hide a surface whose capability an admin has turned off; the gateway still enforces the gate at
 * each route, so this is presentation only, never the security boundary.
 */
export const myCapabilitiesQueryKey = ["me", "capabilities"] as const;

export function useMyCapabilities() {
  return useQuery({ queryKey: myCapabilitiesQueryKey, queryFn: () => getJson<{ enabled: string[] }>("/api/me/capabilities") });
}

/** Whether a governed capability is enabled for the caller. Permissive (true) while the query is loading or
 *  errored, so a surface never flickers off / hides on a transient failure — mirrors how feature gating
 *  stays permissive until data arrives. */
export function capabilityEnabled(data: { enabled?: string[] } | undefined, id: string): boolean {
  return !Array.isArray(data?.enabled) || data.enabled.includes(id);
}
