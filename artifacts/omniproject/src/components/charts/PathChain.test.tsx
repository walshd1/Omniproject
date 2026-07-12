import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PathChain } from "./PathChain";

describe("PathChain", () => {
  it("renders each node in order under the given testId", () => {
    render(<PathChain nodes={["Design", "Build", "Ship"]} testId="chain" />);
    const chain = screen.getByTestId("chain");
    expect(chain.textContent).toContain("Design");
    expect(chain.textContent).toContain("Build");
    expect(chain.textContent).toContain("Ship");
    // Three nodes → two arrow connectors between them.
    expect(chain.querySelectorAll("li").length).toBe(3);
  });

  it("draws no trailing arrow after the last node", () => {
    render(<PathChain nodes={["A", "B"]} testId="c" />);
    // One "→" between two nodes, not two.
    expect(screen.getByTestId("c").textContent).toBe("A→B");
  });

  it("colours nodes critical by default and neutral on request", () => {
    const { rerender } = render(<PathChain nodes={["X"]} testId="c" />);
    expect(screen.getByTestId("c").querySelector("span")!.className).toContain("text-red-600");
    rerender(<PathChain nodes={["X"]} tone="neutral" testId="c" />);
    expect(screen.getByTestId("c").querySelector("span")!.className).toContain("text-foreground");
  });
});
