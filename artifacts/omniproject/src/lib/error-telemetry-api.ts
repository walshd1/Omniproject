import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client read/write for the error-telemetry admin opt-in. It moved OUT of `SettingsState` into the composition
 * model as the security-classified `error-telemetry` config def (roadmap Phase C), exposed at
 * `/api/error-telemetry`. Enabling it REDUCES the security posture, so the PUT may return `202` (held for a
 * signed sign-off) instead of applying immediately — the mutation surfaces that via the returned body.
 */
export const errorTelemetryKey = ["error-telemetry"] as const;

/** The current resolved value (org config def → `ERROR_TELEMETRY` env default → false). */
export function useErrorTelemetry(authed: boolean) {
  const { data } = useQuery({
    queryKey: errorTelemetryKey,
    queryFn: () => getJson<{ errorTelemetry: boolean }>("/api/error-telemetry"),
    enabled: authed,
    staleTime: 15_000,
  });
  return { data: data?.errorTelemetry ?? false };
}

/** PUT the toggle. Resolves with `{ errorTelemetry, pending? }` — `pending` is set when enabling was held for a
 *  signed sign-off (HTTP 202) rather than applied. */
export function useSaveErrorTelemetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (errorTelemetry: boolean) =>
      sendJson<{ errorTelemetry?: boolean; pending?: { proposalId: string; relaxes: string[] } }>(
        "/api/error-telemetry", { errorTelemetry }, "PUT", "Failed to save the error-telemetry setting",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: errorTelemetryKey }),
  });
}
