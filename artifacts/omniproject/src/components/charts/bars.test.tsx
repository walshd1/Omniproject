import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocationBar, ProportionBar, allocationTone } from "./bars";

describe("AllocationBar (SVG)", () => {
  it("renders a vector fill sized proportionally, clamped at max", () => {
    const { container } = render(<AllocationBar value={75} />); // 75 / 150 = 50
    const fill = container.querySelector("rect.fill-current") as SVGRectElement;
    expect(fill.getAttribute("width")).toBe("50");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("tones by allocation band (over/optimal/under) via a fill-current text colour, handles null", () => {
    expect(allocationTone(120)).toBe("text-red-500");
    expect(allocationTone(90)).toBe("text-green-500");
    expect(allocationTone(40)).toBe("text-zinc-500");
    expect(allocationTone(null)).toBe("text-zinc-400");
    const { container } = render(<AllocationBar value={null} />);
    // Null value → no fill rect at all (only the track).
    expect(container.querySelector("rect.fill-current")).toBeNull();
  });
});

describe("ProportionBar (SVG)", () => {
  it("lays out vector segments by share and drops zero segments", () => {
    render(
      <ProportionBar
        testId="dist"
        testIdPrefix="seg"
        segments={[
          { key: "a", value: 3, className: "text-red-500" },
          { key: "b", value: 1, className: "text-green-500" },
          { key: "c", value: 0, className: "text-amber-500" },
        ]}
      />,
    );
    expect(screen.getByTestId("dist")).toBeInTheDocument();
    expect(screen.getByTestId("seg-a").getAttribute("width")).toBe("75"); // 3/4
    expect(screen.getByTestId("seg-b").getAttribute("width")).toBe("25");
    expect(screen.queryByTestId("seg-c")).not.toBeInTheDocument();
  });

  it("renders nothing when every segment is zero", () => {
    const { container } = render(<ProportionBar segments={[{ key: "a", value: 0, className: "text-red-500" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
