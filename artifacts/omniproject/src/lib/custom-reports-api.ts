import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import type { CustomReportDef } from "./custom-report";

/**
 * Bespoke report definitions client. Report defs are ARTIFACTS in the encrypted def store (authored through
 * the ONE importer, kind `report`); here we read the effective set from `GET /api/reports/custom/resolved`
 * (org/project/user def-store reports). Any authed user reads them (so saved reports render for everyone);
 * authoring is PMO-gated server-side. Definitions are presentation config — field keys + how to summarise
 * them — never project data.
 */
export const customReportsQueryKey = ["custom-reports", "resolved"] as const;

/** The effective bespoke report definitions (org/project/user def store, nearest scope winning). */
export function useCustomReports() {
  return useQuery({
    queryKey: customReportsQueryKey,
    queryFn: () => getJson<{ customReports: CustomReportDef[] }>("/api/reports/custom/resolved").then((r) => r.customReports ?? []),
    staleTime: 30_000,
  });
}
