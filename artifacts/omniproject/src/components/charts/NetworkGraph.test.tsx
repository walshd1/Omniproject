import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkGraph, type GraphNode, type GraphEdge } from "./NetworkGraph";

const nodes: GraphNode[] = [
  { id: "a", x: 10, y: 10, label: "Alpha", emphasis: true },
  { id: "b", x: 50, y: 50, label: "Beta" },
  { id: "c", x: 90, y: 20, label: "Gamma" },
];
const edges: GraphEdge[] = [
  { from: "a", to: "b", emphasis: true },
  { from: "b", to: "c", dashed: true },
  { from: "b", to: "missing" }, // dropped: endpoint not in nodes
];

describe("NetworkGraph", () => {
  it("renders a labelled node per item and drops edges with a missing endpoint", () => {
    render(<NetworkGraph nodes={nodes} edges={edges} ariaLabel="deps" testId="g" />);
    const svg = screen.getByTestId("g");
    expect(screen.getByLabelText("deps")).toBe(svg);
    expect(svg.querySelectorAll("circle").length).toBe(3);
    expect(svg.querySelectorAll("text").length).toBe(3);
    // Two of the three edges have both endpoints present.
    expect(svg.querySelectorAll("line").length).toBe(2);
    expect(svg.textContent).toContain("Alpha");
  });

  it("emphasises critical nodes/edges in red and dashes crossing links in amber", () => {
    render(<NetworkGraph nodes={nodes} edges={edges} ariaLabel="deps" testId="g" />);
    const svg = screen.getByTestId("g");
    const critCircle = svg.querySelector("circle")!; // node a, emphasis
    expect(critCircle.getAttribute("r")).toBe("2.6");
    expect(critCircle.className.baseVal).toContain("text-red-500");
    const dashed = Array.from(svg.querySelectorAll("line")).find((l) => l.getAttribute("stroke-dasharray"));
    expect(dashed).toBeTruthy();
    expect(dashed!.className.baseVal).toContain("text-amber-500");
  });
});
