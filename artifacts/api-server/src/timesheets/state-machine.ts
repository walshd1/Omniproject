/**
 * Timesheet workflow — the AUTHORITATIVE copy of the state machine, enforced in the gateway (the SPA
 * has an optimistic mirror in lib/timesheet.ts, but transition rules — especially segregation of
 * duties — can't be trusted to the client). Pure + deterministic. Persistence is NOT here: the sheet
 * is loaded from / saved to the store below the seam (self-host DB or a backend), so the gateway holds
 * nothing; this module only decides the next legal state.
 */
import { round1 } from "@workspace/backend-catalogue";

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export interface TimeEntry {
  id: string;
  projectId: string;
  issueId?: string | null;
  date: string;
  hours: number;
  note?: string | null;
}

export interface Timesheet {
  id: string;
  resourceId: string;
  weekStart: string;
  entries: TimeEntry[];
  status: TimesheetStatus;
  submittedAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  note?: string | null;
}

export type TimesheetAction =
  | { type: "submit"; at: string }
  | { type: "approve"; by: string; at: string }
  | { type: "reject"; by: string; at: string; note?: string }
  | { type: "reopen" };

export class TimesheetError extends Error {}

/** Total logged hours on a sheet (non-finite entries ignored). */
export function timesheetHours(sheet: Timesheet): number {
  return round1(sheet.entries.reduce((a, e) => a + (Number.isFinite(e.hours) ? e.hours : 0), 0));
}

/**
 * Apply a workflow action, returning a NEW sheet (pure). Enforces the transitions — submit only a
 * non-empty draft; approve/reject only a submitted sheet and never by its own owner (segregation of
 * duties); reopen only a rejected sheet. Throws `TimesheetError` on an illegal transition.
 */
export function applyTimesheetAction(sheet: Timesheet, action: TimesheetAction): Timesheet {
  switch (action.type) {
    case "submit":
      if (sheet.status !== "draft") throw new TimesheetError(`cannot submit a ${sheet.status} timesheet`);
      if (sheet.entries.length === 0 || timesheetHours(sheet) <= 0) throw new TimesheetError("cannot submit an empty timesheet");
      return { ...sheet, status: "submitted", submittedAt: action.at, decidedAt: null, decidedBy: null, note: null };
    case "approve":
      if (sheet.status !== "submitted") throw new TimesheetError(`cannot approve a ${sheet.status} timesheet`);
      if (action.by === sheet.resourceId) throw new TimesheetError("a timesheet cannot be approved by its own owner");
      return { ...sheet, status: "approved", decidedBy: action.by, decidedAt: action.at };
    case "reject":
      if (sheet.status !== "submitted") throw new TimesheetError(`cannot reject a ${sheet.status} timesheet`);
      if (action.by === sheet.resourceId) throw new TimesheetError("a timesheet cannot be rejected by its own owner");
      return { ...sheet, status: "rejected", decidedBy: action.by, decidedAt: action.at, ...(action.note ? { note: action.note } : {}) };
    case "reopen":
      if (sheet.status !== "rejected") throw new TimesheetError(`cannot reopen a ${sheet.status} timesheet`);
      return { ...sheet, status: "draft", submittedAt: null, decidedAt: null, decidedBy: null };
  }
}
