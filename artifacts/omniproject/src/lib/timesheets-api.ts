import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { Timesheet, TimesheetAction } from "./timesheet";

/**
 * Timesheets client. Persistence lives BELOW the seam (self-host DB and/or backend, per the store the
 * gateway resolves); the SPA just talks to /api/timesheets. Sources tells the UI whether timesheets
 * are enabled anywhere so it can prompt to adopt self-host / enable a backend source when they aren't.
 */
export interface TimesheetSources {
  available: boolean;
  source: "self-host" | "backend" | null;
  selfHostAdopted: boolean;
}

export const timesheetSourcesQueryKey = ["timesheet-sources"] as const;
export const timesheetsQueryKey = (status?: string) => ["timesheets", status ?? "all"] as const;

export function useTimesheetSources() {
  return useQuery({ queryKey: timesheetSourcesQueryKey, queryFn: () => getJson<TimesheetSources>("/api/timesheets/sources"), staleTime: 30_000 });
}

export function useTimesheets(status?: Timesheet["status"], enabled = true) {
  return useQuery({
    queryKey: timesheetsQueryKey(status),
    queryFn: () => getJson<Timesheet[]>(`/api/timesheets${status ? `?status=${status}` : ""}`),
    enabled,
    staleTime: 15_000,
  });
}

export function useSaveTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sheet: Pick<Timesheet, "id" | "weekStart" | "entries">) => sendJson<Timesheet>("/api/timesheets", sheet, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}

export function useTimesheetAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type, note }: { id: string; type: TimesheetAction["type"]; note?: string }) =>
      sendJson<Timesheet>(`/api/timesheets/${encodeURIComponent(id)}/action`, { type, ...(note ? { note } : {}) }, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timesheets"] }),
  });
}
