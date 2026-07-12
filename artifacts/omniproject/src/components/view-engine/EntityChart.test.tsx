import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityChart } from "./EntityChart";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";

interface W { id: string; status: string; start: string; end: string }
const fields: EntityField<W>[] = [
  { key: "status", label: "Status", get: (w) => w.status },
  { key: "start", label: "Start", get: (w) => w.start, isDate: true },
  { key: "end", label: "End", get: (w) => w.end, isDate: true },
];
const rec = (id: string, status: string, start = "", end = ""): ViewRecord<W> => ({ id, title: id.toUpperCase(), status, priority: null, chips: [], raw: { id, status, start, end } });
const records = [rec("a", "todo", "2026-01-01", "2026-01-31"), rec("b", "todo"), rec("c", "done")];

describe("EntityChart", () => {
  it("renders a gantt spanning each dated record", () => {
    render(<EntityChart records={records} fields={fields} spec={{ type: "gantt", startField: "start", endField: "end" }} noun="widget" />);
    expect(screen.getByTestId("gantt-chart")).toBeInTheDocument();
    expect(screen.getByLabelText("A: 2026-01-01 to 2026-01-31")).toBeInTheDocument();
  });

  it("renders count/share charts without throwing (bar/pie/donut/wbs)", () => {
    for (const type of ["bar", "pie", "donut", "wbs"] as const) {
      expect(() => render(<EntityChart records={records} fields={fields} spec={{ type, groupField: "status" }} noun="widget" />)).not.toThrow();
    }
  });
});
