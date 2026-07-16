import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TablePanel } from "./TablePanel";
import type { Panel } from "../../../lib/screen";

/**
 * When a panel declares a `controls` block, TablePanel turns into a live pivot: it fetches raw object-rows
 * once and re-groups / re-aggregates / filters them in the browser from the control bar. This exercises the
 * whole loop — group change, filter change, aggregation change — asserting the table re-pivots each time.
 */
const rows = [
  { year: "2026", currency: "GBP", amount: 100 },
  { year: "2026", currency: "USD", amount: 50 },
  { year: "2027", currency: "GBP", amount: 200 },
];

function panelWithControls(): Panel {
  return {
    id: "t", kind: "table", title: "Spend",
    config: {
      rows,
      controls: {
        groupBy: ["year", "currency"],
        metricField: "amount",
        metricLabel: "Amount",
        aggs: ["sum", "count"],
        filters: ["currency"],
      },
    },
  };
}

const bodyText = () => screen.getByTestId("table-body").textContent ?? "";

describe("TablePanel controls (live pivot)", () => {
  it("renders the control bar and pivots on the first group by default", () => {
    render(<TablePanel panel={panelWithControls()} />);
    expect(screen.getByTestId("panel-controls")).toBeTruthy();
    // default group is the first dimension (year), summed → 2026:150, 2027:200
    const headers = Array.from(screen.getAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(["year", "amount"]);
    expect(bodyText()).toContain("150");
    expect(bodyText()).toContain("200");
  });

  it("re-pivots when the group-by changes", () => {
    render(<TablePanel panel={panelWithControls()} />);
    fireEvent.change(screen.getByTestId("control-groupby"), { target: { value: "currency" } });
    const headers = Array.from(screen.getAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(["currency", "amount"]);
    // GBP: 100+200=300, USD: 50
    const rowByCur = new Map(Array.from(within(screen.getByTestId("table-body")).getAllByRole("row")).map((tr) => {
      const cells = within(tr).getAllByRole("cell").map((c) => c.textContent);
      return [cells[0], cells[1]] as const;
    }));
    expect(rowByCur.get("GBP")).toBe("300");
    expect(rowByCur.get("USD")).toBe("50");
  });

  it("filters rows before aggregating", () => {
    render(<TablePanel panel={panelWithControls()} />);
    fireEvent.change(screen.getByTestId("control-filter-currency"), { target: { value: "GBP" } });
    // only GBP rows → 2026:100, 2027:200 (USD 50 excluded)
    expect(bodyText()).toContain("100");
    expect(bodyText()).toContain("200");
    expect(bodyText()).not.toContain("50");
  });

  it("switches the metric to a count", () => {
    render(<TablePanel panel={panelWithControls()} />);
    fireEvent.change(screen.getByTestId("control-agg"), { target: { value: "count" } });
    const headers = Array.from(screen.getAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(["year", "count"]);
    // 2026 has two rows, 2027 has one
    const rowByYear = new Map(Array.from(within(screen.getByTestId("table-body")).getAllByRole("row")).map((tr) => {
      const cells = within(tr).getAllByRole("cell").map((c) => c.textContent);
      return [cells[0], cells[1]] as const;
    }));
    expect(rowByYear.get("2026")).toBe("2");
    expect(rowByYear.get("2027")).toBe("1");
  });
});
