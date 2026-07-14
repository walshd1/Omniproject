import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/** The public API discovery document (the fields the SPA reads from it). */
interface Discovery {
  docs?: string;
}

/**
 * The optional API-portal URL, read from the public `/api/discovery` document. The `docs` field is
 * present ONLY when an operator has enabled the portal server-side (API_PORTAL_ENABLED), so a null
 * return means the portal isn't exposed on this deployment — the caller renders nothing.
 */
export function useApiDocsUrl(): string | null {
  const { data } = useQuery({
    queryKey: ["api", "discovery"],
    queryFn: () => getJson<Discovery>("/api/discovery"),
    staleTime: Infinity,
    retry: false,
  });
  return data?.docs ?? null;
}
