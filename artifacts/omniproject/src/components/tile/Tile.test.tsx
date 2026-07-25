import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tile } from "./Tile";

describe("Tile (static vs additive clickable)", () => {
  it("is a plain, non-interactive block by default", () => {
    const { container } = render(<Tile content="Hello" color="#2563eb" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    // Colour applied inline.
    expect(container.firstElementChild).toHaveStyle({ backgroundColor: "#2563eb" });
  });

  it("becomes an interactive button when clickable, firing onClick", () => {
    const onClick = vi.fn();
    render(<Tile content="Go" clickable onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("applies shape + size classes", () => {
    render(<Tile content="Pill" shape="pill" size="large" />);
    const el = screen.getByText("Pill");
    expect(el.className).toMatch(/rounded-full/);
    expect(el.className).toMatch(/py-5/);
  });
});
