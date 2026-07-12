import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("renders label, value and optional hint", () => {
    render(<StatTile label="Open" value="42" hint="this sprint" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("this sprint")).toBeInTheDocument();
  });

  it("colours the value by tone (reserved status colours)", () => {
    render(<StatTile label="At risk" value="7" tone="bad" />);
    expect(screen.getByText("7").className).toContain("text-red-500");
  });

  it("defaults to no tone colour", () => {
    render(<StatTile label="Total" value="10" />);
    const v = screen.getByText("10");
    expect(v.className).not.toContain("text-red-500");
    expect(v.className).not.toContain("text-green-500");
  });
});
