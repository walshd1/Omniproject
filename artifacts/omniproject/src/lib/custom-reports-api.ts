import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { CustomReportDef } from "./custom-report";

/**
 * Bespoke report definitions client. Report defs are ARTIFACTS in the encrypted def store now (authored through
 * the ONE importer, kind `report`); here we read the effective set from `GET /api/reports/custom/resolved` (the
 * server unions the def-store reports with any not-yet-migrated legacy `settings.customReports`). Any authed
 * user reads them (so saved reports render for everyone); authoring is PMO-gated server-side. Definitions are
 * presentation config — field keys + how to summarise them — never project data.
 */
export const customReportsQueryKey = ["custom-reports", "resolved"] as const;
export const legacyCustomReportsQueryKey = ["custom-reports", "legacy"] as const;

/** The effective bespoke report definitions (def store + legacy bridge, def store winning). */
export function useCustomReports() {
  return useQuery({
    queryKey: customReportsQueryKey,
    queryFn: () => getJson<{ customReports: CustomReportDef[] }>("/api/reports/custom/resolved").then((r) => r.customReports ?? []),
    staleTime: 30_000,
  });
}

/** The LEGACY `settings.customReports` slice — only for the one-shot migration (read the old list, import each
 *  as a def, then drain). Not the render source. */
export function useLegacyCustomReports() {
  return useQuery({
    queryKey: legacyCustomReportsQueryKey,
    queryFn: () => getJson<{ customReports: CustomReportDef[] }>("/api/reports/custom").then((r) => r.customReports ?? []),
    staleTime: 30_000,
  });
}

/** Drain the legacy `settings.customReports` slice to [] once its reports have been re-imported as defs. */
export function useDrainLegacyCustomReports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<unknown>("/api/reports/custom", { customReports: [] }, "PUT", "Failed to drain legacy reports"),
    onSuccess: () => qc.invalidateQueries({ queryKey: legacyCustomReportsQueryKey }),
  });
}
