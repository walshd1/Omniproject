import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphPanel } from "./GraphPanel";
import type { Panel } from "../../../lib/screen";

/**
 * GraphPanel — a node-link dependency graph with a circular layout and an accessible edge list.
 * Covers the empty state, singular/plural counts, the label-or-id fallback, the optional edge
 * label, the single-node layout branch and the default title.
 */
const panel = (config: Record<string, unknown>, title?: string): Panel => ({ id: "g", kind: "graph", ...(title ? { title } : {}), config });

describe("GraphPanel", () => {
  it("reports zero nodes/edges and draws nothing when config is empty", () => {
    render(<GraphPanel panel={panel({})} />);
    expect(screen.getByText("Graph")).toBeInTheDocument(); // default title
    expect(screen.getByRole("status")).toHaveTextContent("0 nodes, 0 edges");
    expect(screen.queryByTestId("graph-svg")).not.toBeInTheDocument();
  });

  it("uses singular units for exactly one node and one edge, and draws the graph", () => {
    render(<GraphPanel panel={panel({
      nodes: [{ id: "a", label: "Alpha" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }],
    }, "Deps")} />);
    expect(screen.getByText("Deps")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 nodes, 1 edge");
    expect(screen.getByTestId("graph-svg")).toBeInTheDocument();
    // Edge list uses the node label where present and falls back to the id ("b" has no label).
    expect(screen.getByText("Alpha depends on b")).toBeInTheDocument();
  });

  it("appends an edge's own label in parentheses when provided", () => {
    render(<GraphPanel panel={panel({
      nodes: [{ id: "x", label: "X" }, { id: "y", label: "Y" }],
      edges: [{ from: "x", to: "y", label: "blocks" }],
    })} />);
    expect(screen.getByText("X depends on Y (blocks)")).toBeInTheDocument();
  });

  it("handles a single node (no edges) — draws the node but no edge list", () => {
    render(<GraphPanel panel={panel({ nodes: [{ id: "solo", label: "Solo" }] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 node, 0 edges");
    expect(screen.getByTestId("graph-svg")).toBeInTheDocument();
    expect(screen.queryByLabelText("Graph edges")).not.toBeInTheDocument();
  });

  it("treats non-array nodes/edges configs as empty", () => {
    render(<GraphPanel panel={panel({ nodes: "no", edges: 3 })} />);
    expect(screen.getByRole("status")).toHaveTextContent("0 nodes, 0 edges");
  });
});
