import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RecordTimeline } from "./RecordTimeline";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";

interface W { id: string; due: string | null }
const DUE: EntityField<W> = { key: "due", label: "Due", get: (w) => w.due, isDate: true };
const rec = (id: string, due: string | null): ViewRecord<W> => ({ id, title: id.toUpperCase(), status: "next", priority: null, chips: [], raw: { id, due } });
const RECS = [rec("a", "2026-07-15"), rec("b", "2026-08-02"), rec("c", null)];

describe("RecordTimeline", () => {
  it("buckets records by the month of the date field", () => {
    render(<RecordTimeline records={RECS} field={DUE} noun="widget" labelForPriority={() => ""} onOpen={() => {}} />);
    expect(within(screen.getByLabelText("Jul 2026")).getByText("A")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Aug 2026")).getByText("B")).toBeInTheDocument();
  });

  it("collects undated records in a 'No date' column", () => {
    render(<RecordTimeline records={RECS} field={DUE} noun="widget" labelForPriority={() => ""} onOpen={() => {}} />);
    expect(within(screen.getByLabelText("No date")).getByText("C")).toBeInTheDocument();
  });

  it("prompts to pick a field when none is given", () => {
    render(<RecordTimeline records={RECS} field={undefined} noun="widget" labelForPriority={() => ""} onOpen={() => {}} />);
    expect(screen.getByText(/pick a date field/i)).toBeInTheDocument();
  });

  it("opens a record on title click", () => {
    const onOpen = vi.fn();
    render(<RecordTimeline records={RECS} field={DUE} noun="widget" labelForPriority={() => ""} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("A"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});
