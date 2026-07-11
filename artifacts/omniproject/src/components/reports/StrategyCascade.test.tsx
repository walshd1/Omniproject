import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyCascade } from "./StrategyCascade";
import type { CascadeItem } from "../../lib/strategy-cascade";

const items: CascadeItem[] = [
  { id: "a", name: "Alpha", strategicTheme: "Growth", objectives: ["Expand EU"], kpis: ["NPS: 45/60"], strategicContribution: 100, progressPct: 80 },
  { id: "b", name: "Beta", strategicTheme: "Growth", objectives: ["Expand EU"], strategicContribution: 50, progressPct: 20 },
  { id: "c", name: "Gamma" }, // unaligned
];

describe("StrategyCascade", () => {
  it("renders nothing when there's no strategy data", () => {
    const { container } = render(<StrategyCascade items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the theme → objective tree with rolled-up progress and a key result", () => {
    render(<StrategyCascade items={items} />);
    expect(screen.getByTestId("cascade-theme-Growth")).toBeInTheDocument();
    expect(screen.getByTestId("cascade-objective-Expand EU")).toBeInTheDocument();
    // weighted progress (100*80 + 50*20)/150 = 60
    expect(screen.getByTestId("cascade-objective-Expand EU")).toHaveTextContent("60%");
    expect(screen.getByText(/NPS · 75%/)).toBeInTheDocument();
  });

  it("surfaces coverage and unaligned initiatives", () => {
    render(<StrategyCascade items={items} />);
    expect(screen.getByTestId("strategy-cascade-coverage")).toHaveTextContent("66.7% of initiatives aligned");
    expect(screen.getByTestId("strategy-cascade-unaligned")).toHaveTextContent("Gamma");
  });
});
