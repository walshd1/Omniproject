import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocationBar, ProportionBar, allocationTone } from "./bars";

describe("AllocationBar", () => {
  it("fills the track proportionally and clamps at max", () => {
    const { container } = render(<AllocationBar value={75} />); // 75 / 150 = 50%
    const fill = container.querySelector('[style*="width"]') as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("tones by allocation band (over/optimal/under) and handles null", () => {
    expect(allocationTone(120)).toBe("bg-red-500");
    expect(allocationTone(90)).toBe("bg-green-500");
    expect(allocationTone(40)).toBe("bg-zinc-500");
    expect(allocationTone(null)).toBe("bg-zinc-400");
    const { container } = render(<AllocationBar value={null} />);
    expect((container.querySelector('[style*="width"]') as HTMLElement).style.width).toBe("0%");
  });
});

describe("ProportionBar", () => {
  it("lays out segments by share and drops zero segments", () => {
    render(
      <ProportionBar
        testId="dist"
        testIdPrefix="seg"
        segments={[
          { key: "a", value: 3, className: "bg-red-500" },
          { key: "b", value: 1, className: "bg-green-500" },
          { key: "c", value: 0, className: "bg-amber-500" },
        ]}
      />,
    );
    expect(screen.getByTestId("dist")).toBeInTheDocument();
    expect((screen.getByTestId("seg-a")).style.width).toBe("75%"); // 3/4
    expect(screen.getByTestId("seg-b").style.width).toBe("25%");
    expect(screen.queryByTestId("seg-c")).not.toBeInTheDocument();
  });

  it("renders nothing when every segment is zero", () => {
    const { container } = render(<ProportionBar segments={[{ key: "a", value: 0, className: "bg-red-500" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
