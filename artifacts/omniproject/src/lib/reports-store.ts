import { useQuery } from "@tanstack/react-query";
import { REPORTS, getReport as getBuiltinReport, type ReportDefinition } from "@workspace/backend-catalogue";
import { getJson } from "./api";

/**
 * The per-deployment REPORT DEFINITION store (GET /api/reports). Report definitions live in the deployment's
 * JSON config, seeded from the built-in catalogue — so a deployment owns its report set as data, bound to a
 * registered renderer (see components/reports/report-renderers). The bundled catalogue is the initialData +
 * fallback, so cards render immediately and never flash empty if the request is slow or fails.
 */
export const reportsStoreQueryKey = ["reports-store"] as const;

/** The deployment's effective report definitions (store, falling back to the bundled catalogue). */
export function useReports(): ReportDefinition[] {
  const { data } = useQuery({
    queryKey: reportsStoreQueryKey,
    queryFn: () => getJson<{ reports: ReportDefinition[] }>("/api/reports").then((r) => r.reports),
    initialData: REPORTS,
    staleTime: 60_000,
  });
  return data ?? REPORTS;
}

/** Resolve one report definition by id from a definition list, falling back to the bundled catalogue so a
 *  page can always name a built-in report even before the store request resolves. */
export function findReport(reports: ReportDefinition[], id: string): ReportDefinition | undefined {
  return reports.find((r) => r.id === id) ?? getBuiltinReport(id);
}
