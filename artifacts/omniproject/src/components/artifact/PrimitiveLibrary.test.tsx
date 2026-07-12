import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrimitiveLibrary } from "./PrimitiveLibrary";
import { PRIMITIVE_CATALOGUE } from "../charts/catalogue";

describe("PrimitiveLibrary", () => {
  it("renders a card for every catalogue primitive under its category", () => {
    render(<PrimitiveLibrary />);
    for (const p of PRIMITIVE_CATALOGUE) {
      expect(screen.getByTestId(`primitive-library-item-${p.id}`)).toBeInTheDocument();
    }
    // Category sections are present.
    expect(screen.getByTestId("primitive-library-chart")).toBeInTheDocument();
    expect(screen.getByTestId("primitive-library-tile")).toBeInTheDocument();
  });

  it("shows each primitive's required inputs", () => {
    render(<PrimitiveLibrary />);
    const gantt = screen.getByTestId("primitive-library-item-gantt");
    expect(gantt.textContent).toContain("Items"); // its one required param
  });

  it("offers a Use action only when onPick is given, and calls it with the primitive", () => {
    const onPick = vi.fn();
    const { rerender } = render(<PrimitiveLibrary />);
    expect(screen.queryByTestId("primitive-library-pick-bar")).toBeNull();
    rerender(<PrimitiveLibrary onPick={onPick} />);
    fireEvent.click(screen.getByTestId("primitive-library-pick-bar"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "bar" }));
  });
});
