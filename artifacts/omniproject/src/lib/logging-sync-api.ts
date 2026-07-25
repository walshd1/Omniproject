import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey } from "@workspace/api-client-react";
import { getJson, sendJson } from "./api";

/**
 * Client read/write for the logging-sync egress config. It moved OUT of `SettingsState` into the composition
 * model as the security-classified `logging-sync` config def (roadmap Phase C), exposed at `/api/logging-sync`.
 * Enabling it (or redirecting the destination) REDUCES the posture, so the PUT may return `202` (held for a
 * signed sign-off) instead of applying immediately — the mutation surfaces that via the returned body.
 */
export interface LoggingSyncConfig {
  enabled: boolean;
  url: string | null;
  acknowledgedWarranty: boolean;
}

export const loggingSyncKey = ["logging-sync"] as const;

/** The current resolved config (org config def → `LOGGING_SYNC_*` env default → off). */
export function useLoggingSync() {
  const { data } = useQuery({
    queryKey: loggingSyncKey,
    queryFn: () => getJson<{ loggingSync: LoggingSyncConfig }>("/api/logging-sync"),
    staleTime: 15_000,
  });
  return { data: data?.loggingSync };
}

/** PUT the config. Resolves with `{ loggingSync?, pending? }` — `pending` is set when enabling was held for a
 *  signed sign-off (HTTP 202) rather than applied. */
export function useSaveLoggingSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loggingSync: LoggingSyncConfig) =>
      sendJson<{ loggingSync?: LoggingSyncConfig; pending?: { proposalId: string; relaxes: string[] } }>(
        "/api/logging-sync", { loggingSync }, "PUT", "Failed to save the logging-sync setting",
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loggingSyncKey });
      qc.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() }); // time-travel capability flips with it
    },
  });
}
