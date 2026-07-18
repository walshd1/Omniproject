/**
 * Timesheets — weekly time entry + a submit → approve/reject state machine, and the actuals rollup
 * that feeds utilisation / EVM. This is the module the enterprise suites (Clarity, Sciforma) have that
 * a pure-analytics overlay lacks. Consistent with the stateless posture, the *persistence* is brokered
 * to the backend; THIS module is the pure workflow + rollup logic (deterministic, unit-testable), so
 * the transition rules (no self-approval, no empty submit, only submitted can be approved) hold
 * identically wherever they run.
 */

import { round1 } from "./num";
export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

/** One line: hours logged against a project (and optionally a work item) on a day. */
export interface TimeEntry {
  id: string;
  projectId: string;
  issueId?: string | null;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  hours: number;
  note?: string | null;
}

export interface Timesheet {
  id: string;
  resourceId: string;
  /** ISO date of the week's Monday. */
  weekStart: string;
  entries: TimeEntry[];
  status: TimesheetStatus;
  submittedAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  /** Approver's note (esp. on reject). */
  note?: string | null;
}

export type TimesheetAction =
  | { type: "submit"; at: string }
  | { type: "approve"; by: string; at: string }
  | { type: "reject"; by: string; at: string; note?: string }
  | { type: "reopen" };

export class TimesheetError extends Error {}


/** Total hours on a sheet. */
export function timesheetHours(sheet: Timesheet): number {
  return round1(sheet.entries.reduce((a, e) => a + (Number.isFinite(e.hours) ? e.hours : 0), 0));
}

/**
 * Apply a workflow action, returning a NEW sheet (pure). Enforces the transition rules:
 *  - submit: only a non-empty draft (or a reopened rejected sheet) may be submitted;
 *  - approve/reject: only a submitted sheet, and never by its own owner (segregation of duties);
 *  - reopen: only a rejected sheet, back to draft for correction.
 * Throws `TimesheetError` on an illegal transition — the same guard the UI and any API share.
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

/** Which actions are legal from the current status (for enabling UI controls). */
export function availableActions(sheet: Timesheet): TimesheetAction["type"][] {
  switch (sheet.status) {
    case "draft": return timesheetHours(sheet) > 0 ? ["submit"] : [];
    case "submitted": return ["approve", "reject"];
    case "rejected": return ["reopen"];
    case "approved": return [];
  }
}

export interface ActualsRow {
  key: string;
  loggedHours: number;
  approvedHours: number;
}

/**
 * Roll APPROVED hours up per project (the actuals that should feed utilisation / EVM `loggedHours`).
 * `loggedHours` counts every submitted-or-approved sheet; `approvedHours` only approved — so a report
 * can choose whether to trust pending time. Draft time is excluded (not yet a claim).
 */
export function timesheetActualsByProject(sheets: readonly Timesheet[]): ActualsRow[] {
  const logged = new Map<string, number>();
  const approved = new Map<string, number>();
  for (const s of sheets) {
    const counts = s.status === "submitted" || s.status === "approved";
    if (!counts) continue;
    for (const e of s.entries) {
      const h = Number.isFinite(e.hours) ? e.hours : 0;
      logged.set(e.projectId, (logged.get(e.projectId) ?? 0) + h);
      if (s.status === "approved") approved.set(e.projectId, (approved.get(e.projectId) ?? 0) + h);
    }
  }
  return [...logged.keys()]
    .map((key) => ({ key, loggedHours: round1(logged.get(key) ?? 0), approvedHours: round1(approved.get(key) ?? 0) }))
    .sort((a, b) => b.loggedHours - a.loggedHours || a.key.localeCompare(b.key));
}
