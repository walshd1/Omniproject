import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ScreenRenderer } from "./ScreenRenderer";
import { hasPanelRenderer } from "./registry";
import type { ScreenDef } from "../../lib/screen";

/**
 * ScreenRenderer tests — one generic renderer drives a screen of panels: each
 * known kind renders, an unknown kind degrades gracefully, methodology presets +
 * capability gating filter the panels.
 */

const SAMPLE: ScreenDef = {
  id: "sample",
  label: "Sample",
  panels: [
    { id: "p-metric", kind: "metric", title: "Open issues", config: { value: 42, unit: "open" } },
    { id: "p-text", kind: "text", title: "About", config: { text: "Hello panels" } },
    { id: "p-table", kind: "table", title: "Grid", config: { columns: ["A", "B"], rows: [[1, 2]] } },
    { id: "p-list", kind: "list", title: "Feed", config: { items: [{ title: "Item one" }] } },
  ],
};

describe("ScreenRenderer", () => {
  it("renders each known panel kind through the one renderer", () => {
    renderWithProviders(<ScreenRenderer screen={SAMPLE} />);
    expect(screen.getByTestId("screen-renderer")).toHaveAttribute("data-screen", "sample");
    expect(screen.getByText("42")).toBeInTheDocument(); // metric
    expect(screen.getByText("Hello panels")).toBeInTheDocument(); // text
    expect(screen.getByText("Grid")).toBeInTheDocument(); // table title
    expect(screen.getByText("Item one")).toBeInTheDocument(); // list
  });

  it("renders the graph + map visual primitives as accessible data views", () => {
    expect(hasPanelRenderer("graph")).toBe(true);
    expect(hasPanelRenderer("map")).toBe(true);
    const s: ScreenDef = {
      id: "viz",
      label: "Viz",
      panels: [
        { id: "g", kind: "graph", title: "Dependencies", config: { nodes: [{ id: "a", label: "Auth" }, { id: "b", label: "Gateway" }], edges: [{ from: "b", to: "a" }] } },
        { id: "m", kind: "map", title: "Sites", config: { points: [{ label: "London", lat: 51.5074, lng: -0.1278 }] } },
      ],
    };
    renderWithProviders(<ScreenRenderer screen={s} />);
    expect(screen.getByText(/2 nodes, 1 edge/)).toBeInTheDocument();
    expect(screen.getByText(/Gateway/)).toBeInTheDocument(); // edge label resolved
    expect(screen.getByText(/1 location/)).toBeInTheDocument();
    expect(screen.getByText(/London/)).toBeInTheDocument();
    // Neither degrades to the unknown placeholder.
    expect(screen.queryByTestId("unknown-panel")).not.toBeInTheDocument();
  });

  it("degrades an unknown panel kind to a placeholder instead of crashing", () => {
    const s: ScreenDef = { id: "x", label: "X", panels: [{ id: "p", kind: "board", title: "Board" }] };
    renderWithProviders(<ScreenRenderer screen={s} />);
    expect(screen.getByTestId("unknown-panel")).toBeInTheDocument();
  });

  it("a methodology preset activates only the panels tagged with it (+ neutral)", () => {
    const s: ScreenDef = {
      id: "m",
      label: "M",
      panels: [
        { id: "k", kind: "metric", title: "Kanban only", methodologies: ["kanban"], config: { value: 1 } },
        { id: "s", kind: "metric", title: "Scrum only", methodologies: ["scrum"], config: { value: 2 } },
        { id: "n", kind: "text", title: "Always", config: { text: "neutral" } },
      ],
    };
    renderWithProviders(<ScreenRenderer screen={s} methodology="kanban" />);
    expect(screen.getByText("Kanban only")).toBeInTheDocument();
    expect(screen.queryByText("Scrum only")).not.toBeInTheDocument();
    expect(screen.getByText("neutral")).toBeInTheDocument(); // untagged = neutral
  });

  it("hides a panel whose required backend capability is unavailable", () => {
    const s: ScreenDef = {
      id: "c",
      label: "C",
      panels: [
        { id: "fin", kind: "metric", title: "Budget", needs: "financials", config: { value: 9 } },
        { id: "always", kind: "text", title: "Always", config: { text: "shown" } },
      ],
    };
    renderWithProviders(<ScreenRenderer screen={s} caps={{ financials: false }} />);
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
    expect(screen.getByText("shown")).toBeInTheDocument();
  });
});
