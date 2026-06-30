import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { CustomReportDef } from "./custom-report";

/**
 * Bespoke report definitions client. Any authed user reads them (so saved reports render for everyone);
 * authoring is PMO-gated server-side. Definitions are presentation config — field keys + how to
 * summarise them — never project data.
 */
export const customReportsQueryKey = ["custom-reports"] as const;

/** The saved bespoke report definitions. */
export function useCustomReports() {
  return useQuery({
    queryKey: customReportsQueryKey,
    queryFn: () => getJson<{ customReports: CustomReportDef[] }>("/api/reports/custom").then((r) => r.customReports),
    staleTime: 30_000,
  });
}

/** Persist the bespoke report list (pmo). */
export function useSaveCustomReports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customReports: CustomReportDef[]) => sendJson<{ customReports: CustomReportDef[] }>("/api/reports/custom", { customReports }),
    onSuccess: (data) => qc.setQueryData(customReportsQueryKey, data.customReports),
  });
}
