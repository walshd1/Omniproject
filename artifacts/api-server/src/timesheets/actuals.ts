/**
 * Timesheet ACTUALS — turn approved timesheets into the internal staff-cost figure. Approved hours per
 * resource × the same PMO rate card = internal staff cost from actuals, reported ALONGSIDE the
 * backend-logged cost (not replacing it), so the PMO sees "what the tracked time actually cost". Pure
 * over the injected store + the existing staffCost math; the gateway holds nothing.
 */
import type { TimesheetStore } from "./store";
import type { Timesheet } from "./state-machine";

/** Sum APPROVED timesheet hours per resource for one project (draft/submitted excluded). */
export async function approvedHoursByResource(store: TimesheetStore, projectId: string): Promise<Record<string, number>> {
  const sheets = await store.list({ status: "approved" });
  const byResource: Record<string, number> = {};
  for (const sheet of sheets as Timesheet[]) {
    for (const e of sheet.entries) {
      if (e.projectId !== projectId) continue;
      const h = Number.isFinite(e.hours) ? e.hours : 0;
      byResource[sheet.resourceId] = (byResource[sheet.resourceId] ?? 0) + h;
    }
  }
  return byResource;
}

/** Synthetic internal-time work items (one per resource) so approved hours flow through `staffCost`. */
export function approvedItemsFrom(byResource: Record<string, number>): { assignee: string; loggedHours: number; billable: boolean }[] {
  return Object.entries(byResource).map(([assignee, loggedHours]) => ({ assignee, loggedHours, billable: false }));
}
