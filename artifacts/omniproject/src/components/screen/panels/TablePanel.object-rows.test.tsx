import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TablePanel } from "./TablePanel";
import type { Panel } from "../../../lib/screen";

/**
 * TablePanel also accepts OBJECT-ROWS — the `{ rows: [{...}] }` shape every rows/rollup endpoint emits —
 * deriving its columns from the rows' keys when none are configured. This is what lets a `source`-bound
 * panel render an endpoint's output with zero per-panel config. Positional array rows still work (see
 * TablePanel.windowing.test).
 */
describe("TablePanel object-rows", () => {
  it("derives columns from the union of the rows' keys when none are configured", () => {
    const panel: Panel = {
      id: "t", kind: "table", title: "By year",
      config: { rows: [{ year: "2026", "sum amount": 100 }, { year: "2027", "sum amount": 250 }] },
    };
    render(<TablePanel panel={panel} />);
    const headers = Array.from(screen.getAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(["year", "sum amount"]);
    expect(screen.getByTestId("table-body").textContent).toContain("2026");
    expect(screen.getByTestId("table-body").textContent).toContain("250");
  });

  it("honours an explicit columns list (selecting + ordering fields) over object-rows", () => {
    const panel: Panel = {
      id: "t", kind: "table",
      config: { columns: ["projectId", "sum amount"], rows: [{ projectId: "p1", year: "2026", "sum amount": 100 }] },
    };
    render(<TablePanel panel={panel} />);
    const headers = Array.from(screen.getAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(["projectId", "sum amount"]); // `year` omitted
    expect(screen.getByTestId("table-body").textContent).toContain("p1");
    expect(screen.getByTestId("table-body").textContent).not.toContain("2026");
  });

  it("renders an empty grid (no crash) for an empty rows array", () => {
    const panel: Panel = { id: "t", kind: "table", config: { rows: [] } };
    render(<TablePanel panel={panel} />);
    expect(screen.getByTestId("table-body").querySelectorAll("tr").length).toBe(0);
  });
});
