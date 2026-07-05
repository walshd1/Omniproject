import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, type StatusMeta } from "./StatusBadge";

type Kind = "a" | "b";
const META: Record<Kind, StatusMeta> = {
  a: { label: "AYE", cls: "border-red-500", title: "It's a" },
  b: { label: "BEE", cls: "border-blue-500", title: "It's b" },
};

describe("StatusBadge", () => {
  it("renders the label + tooltip for a known value", () => {
    render(<StatusBadge value="b" meta={META} fallback="a" />);
    const badge = screen.getByText("BEE");
    expect(badge).toHaveAttribute("title", "It's b");
  });

  it("falls back for an unrecognised value instead of crashing", () => {
    render(<StatusBadge value={"bogus" as Kind} meta={META} fallback="a" />);
    expect(screen.getByText("AYE")).toBeInTheDocument();
  });

  it("falls back when value is omitted", () => {
    render(<StatusBadge meta={META} fallback="b" />);
    expect(screen.getByText("BEE")).toBeInTheDocument();
  });

  it("applies an extra className alongside the base pill styling", () => {
    render(<StatusBadge value="a" meta={META} fallback="a" className="extra-cls" />);
    expect(screen.getByText("AYE")).toHaveClass("extra-cls");
  });
});
