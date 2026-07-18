import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client read/write for the AI-provider allowlist — the org's governance FLOOR over which providers may be
 * selected (roadmap Phase C), exposed at `/api/ai/provider-allowlist`. `null` = unrestricted (every provider is
 * selectable). A lower scope may only narrow the org ceiling; the value here is already the floor-resolved set.
 * The provider picker filters to it, and the server rejects a `PATCH /settings` that selects a forbidden provider.
 */
export const aiProviderAllowlistKey = ["ai-provider-allowlist"] as const;

/** The floor-resolved allowed provider set, or `null` (unrestricted). */
export function useAiProviderAllowlist() {
  const { data } = useQuery({
    queryKey: aiProviderAllowlistKey,
    queryFn: () => getJson<{ aiProviderAllowlist: string[] | null }>("/api/ai/provider-allowlist"),
    staleTime: 15_000,
  });
  return { data: data?.aiProviderAllowlist ?? null };
}

/** PUT the ORG allowlist ceiling (admin). `null` clears the restriction. */
export function useSaveAiProviderAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aiProviderAllowlist: string[] | null) =>
      sendJson<{ aiProviderAllowlist: string[] | null }>(
        "/api/ai/provider-allowlist", { aiProviderAllowlist }, "PUT", "Failed to save the AI provider allowlist",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiProviderAllowlistKey }),
  });
}

/** Whether `provider` may be SELECTED given the resolved allowlist. `"none"` (AI off) is always allowed. */
export function providerSelectable(provider: string, allowlist: string[] | null): boolean {
  return provider === "none" || allowlist == null || allowlist.includes(provider);
}
