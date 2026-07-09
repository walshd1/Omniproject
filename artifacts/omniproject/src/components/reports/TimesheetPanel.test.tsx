import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimesheetPanel } from "./TimesheetPanel";
import type { Timesheet } from "../../lib/timesheet";

const sheet = (over: Partial<Timesheet> = {}): Timesheet => ({
  id: "ts1", resourceId: "u1", weekStart: "2026-01-05",
  entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }, { id: "e2", projectId: "p1", date: "2026-01-06", hours: 4 }],
  status: "draft", ...over,
});

describe("TimesheetPanel", () => {
  it("renders entries, the total, and the status", () => {
    render(<TimesheetPanel sheet={sheet()} />);
    expect(screen.getByTestId("timesheet-total")).toHaveTextContent("12h");
    expect(screen.getByTestId("timesheet-status")).toHaveTextContent("draft");
  });

  it("offers Submit on a draft and emits the action", () => {
    const onAction = vi.fn();
    render(<TimesheetPanel sheet={sheet()} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("timesheet-action-submit"));
    expect(onAction).toHaveBeenCalledWith("submit");
  });

  it("offers Approve/Reject on a submitted sheet to a manager", () => {
    render(<TimesheetPanel sheet={sheet({ status: "submitted" })} currentUserId="mgr" />);
    expect(screen.getByTestId("timesheet-action-approve")).toBeInTheDocument();
    expect(screen.getByTestId("timesheet-action-reject")).toBeInTheDocument();
  });

  it("hides Approve/Reject from the sheet's own owner (segregation of duties)", () => {
    render(<TimesheetPanel sheet={sheet({ status: "submitted" })} currentUserId="u1" />);
    expect(screen.queryByTestId("timesheet-action-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timesheet-action-reject")).not.toBeInTheDocument();
  });

  it("shows the reviewer note on a rejected sheet and offers Reopen", () => {
    render(<TimesheetPanel sheet={sheet({ status: "rejected", note: "wrong project" })} />);
    expect(screen.getByTestId("timesheet-note")).toHaveTextContent("wrong project");
    expect(screen.getByTestId("timesheet-action-reopen")).toBeInTheDocument();
  });
});
