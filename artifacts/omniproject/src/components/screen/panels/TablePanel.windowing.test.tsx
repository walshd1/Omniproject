import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TablePanel } from "./TablePanel";
import type { Panel } from "../../../lib/screen";

/**
 * The table panel windows large datasets: only the first maxRows render until the
 * "show all" expander is used.
 */
describe("TablePanel windowing", () => {
  const bigPanel: Panel = {
    id: "t", kind: "table", title: "Big",
    config: { columns: ["n"], rows: Array.from({ length: 120 }, (_, i) => [i]), maxRows: 50 },
  };

  it("renders only maxRows up front, with an expander for the rest", () => {
    render(<TablePanel panel={bigPanel} />);
    expect(screen.getByTestId("table-body").querySelectorAll("tr").length).toBe(50);
    expect(screen.getByTestId("table-show-all")).toHaveTextContent("70 more");
  });

  it("expands to all rows when clicked", () => {
    render(<TablePanel panel={bigPanel} />);
    fireEvent.click(screen.getByTestId("table-show-all"));
    expect(screen.getByTestId("table-body").querySelectorAll("tr").length).toBe(120);
    expect(screen.queryByTestId("table-show-all")).not.toBeInTheDocument();
  });

  it("no expander when rows fit within maxRows", () => {
    const small: Panel = { id: "s", kind: "table", config: { columns: ["n"], rows: [[1], [2]] } };
    render(<TablePanel panel={small} />);
    expect(screen.queryByTestId("table-show-all")).not.toBeInTheDocument();
  });
});
