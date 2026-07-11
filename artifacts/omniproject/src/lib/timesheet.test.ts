import { describe, it, expect } from "vitest";
import {
  applyTimesheetAction,
  availableActions,
  timesheetActualsByProject,
  timesheetHours,
  TimesheetError,
  type Timesheet,
} from "./timesheet";

const sheet = (over: Partial<Timesheet> = {}): Timesheet => ({
  id: "ts1", resourceId: "u1", weekStart: "2026-01-05",
  entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }],
  status: "draft", ...over,
});

describe("timesheet workflow", () => {
  it("submits a non-empty draft", () => {
    const s = applyTimesheetAction(sheet(), { type: "submit", at: "2026-01-09T17:00:00Z" });
    expect(s.status).toBe("submitted");
    expect(s.submittedAt).toBe("2026-01-09T17:00:00Z");
  });

  it("refuses to submit an empty timesheet", () => {
    expect(() => applyTimesheetAction(sheet({ entries: [] }), { type: "submit", at: "t" })).toThrow(TimesheetError);
  });

  it("approves a submitted sheet — but never by its own owner (segregation of duties)", () => {
    const submitted = sheet({ status: "submitted" });
    expect(() => applyTimesheetAction(submitted, { type: "approve", by: "u1", at: "t" })).toThrow(/own owner/);
    const approved = applyTimesheetAction(submitted, { type: "approve", by: "mgr", at: "2026-01-10T09:00:00Z" });
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("mgr");
  });

  it("rejects with a note, then reopens back to draft for correction", () => {
    const rejected = applyTimesheetAction(sheet({ status: "submitted" }), { type: "reject", by: "mgr", at: "t", note: "wrong project" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.note).toBe("wrong project");
    const reopened = applyTimesheetAction(rejected, { type: "reopen" });
    expect(reopened.status).toBe("draft");
    expect(reopened.submittedAt).toBeNull();
  });

  it("blocks illegal transitions (approve a draft, submit an approved)", () => {
    expect(() => applyTimesheetAction(sheet(), { type: "approve", by: "mgr", at: "t" })).toThrow(/cannot approve a draft/);
    expect(() => applyTimesheetAction(sheet({ status: "approved" }), { type: "submit", at: "t" })).toThrow(/cannot submit a[n]? approved/);
  });

  it("availableActions reflects the status", () => {
    expect(availableActions(sheet())).toEqual(["submit"]);
    expect(availableActions(sheet({ entries: [] }))).toEqual([]);
    expect(availableActions(sheet({ status: "submitted" }))).toEqual(["approve", "reject"]);
    expect(availableActions(sheet({ status: "rejected" }))).toEqual(["reopen"]);
    expect(availableActions(sheet({ status: "approved" }))).toEqual([]);
  });

  it("timesheetHours totals the entries", () => {
    expect(timesheetHours(sheet({ entries: [{ id: "a", projectId: "p", date: "d", hours: 4 }, { id: "b", projectId: "p", date: "d", hours: 3.5 }] }))).toBe(7.5);
  });

  it("actuals roll approved + submitted hours up per project (draft excluded)", () => {
    const rows = timesheetActualsByProject([
      sheet({ id: "a", status: "approved", entries: [{ id: "1", projectId: "p1", date: "d", hours: 10 }] }),
      sheet({ id: "b", status: "submitted", entries: [{ id: "2", projectId: "p1", date: "d", hours: 5 }] }),
      sheet({ id: "c", status: "draft", entries: [{ id: "3", projectId: "p1", date: "d", hours: 99 }] }), // excluded
    ]);
    const p1 = rows.find((r) => r.key === "p1")!;
    expect(p1.loggedHours).toBe(15); // approved + submitted
    expect(p1.approvedHours).toBe(10); // approved only
  });
});
