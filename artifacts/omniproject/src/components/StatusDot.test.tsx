import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusDot, PriorityDot } from "./StatusDot";

describe("StatusDot", () => {
  it("renders a swatch for a known status", () => {
    const { container } = render(<StatusDot status="done" />);
    const dot = container.querySelector("span");
    expect(dot).toBeTruthy();
    expect(dot?.className).toMatch(/rounded-full/);
  });

  it("still renders (neutral swatch) for an unknown backend-agnostic status", () => {
    const { container } = render(<StatusDot status="some_custom_backend_state" />);
    expect(container.querySelector("span")).toBeTruthy();
  });
});

describe("PriorityDot", () => {
  it("exposes the priority as a title so it is not conveyed by colour alone", () => {
    // This is the ScrumView a11y fix: priority must have a text alternative.
    const { container } = render(<PriorityDot priority="high" title="high" />);
    const dot = container.querySelector("span");
    expect(dot?.getAttribute("title")).toBe("high");
  });

  it("renders without a title when none is given", () => {
    const { container } = render(<PriorityDot priority="low" />);
    expect(container.querySelector("span")).toBeTruthy();
  });
});
