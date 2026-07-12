import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children in the shared pill markup", () => {
    render(<Badge testId="b">Overloaded</Badge>);
    const el = screen.getByTestId("b");
    expect(el.textContent).toBe("Overloaded");
    // The shared pill substrate: every consumer inherits the same shape classes.
    expect(el.className).toContain("rounded-sm");
    expect(el.className).toContain("font-black");
  });

  it("colours by tone — a critical badge carries the reserved red status class", () => {
    render(<Badge tone="bad" testId="bad">3</Badge>);
    expect(screen.getByTestId("bad").className).toContain("text-red-500");
  });

  it("defaults to the neutral tone and merges an extra className", () => {
    render(<Badge testId="n" className="tabular-nums">7</Badge>);
    const el = screen.getByTestId("n");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toContain("tabular-nums");
  });

  it("applies a title when given", () => {
    render(<Badge testId="t" title="hover text">x</Badge>);
    expect(screen.getByTestId("t").getAttribute("title")).toBe("hover text");
  });
});
