import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TablePanel } from "./TablePanel";
import { overdueDrillTo } from "../../../lib/drill-to";
import type { Panel } from "../../../lib/screen";

/**
 * TablePanel drill-through: with a `drillTo` descriptor (the same one reports use), clicking a row resolves
 * it and navigates to the pre-filtered work-item grid. Without one, rows aren't clickable.
 */
describe("TablePanel drill-through", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("makes rows clickable and navigates to the filtered grid on click", () => {
    const panel: Panel = {
      id: "t", kind: "table", title: "By year",
      config: { rows: [{ year: "2026", amount: 100, projectId: "p1" }], drillTo: overdueDrillTo() },
    };
    render(<TablePanel panel={panel} />);
    const row = screen.getByTestId("table-drill-0");
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(window.location.pathname).toBe("/projects/p1");
    expect(window.location.search).toContain("filter");
  });

  it("leaves rows non-clickable when no drillTo is configured", () => {
    const panel: Panel = { id: "t", kind: "table", config: { rows: [{ year: "2026", amount: 100 }] } };
    render(<TablePanel panel={panel} />);
    expect(screen.queryByTestId("table-drill-0")).toBeNull();
  });
});
