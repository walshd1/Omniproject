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

  it("colours by tone — a critical badge carries the reserved red status class (AA-contrast shade)", () => {
    render(<Badge tone="bad" testId="bad">3</Badge>);
    // WCAG 1.4.3: red-700 on light (≥4.5:1 over the faint tint), red-400 on dark.
    expect(screen.getByTestId("bad").className).toContain("text-red-700");
    expect(screen.getByTestId("bad").className).toContain("dark:text-red-400");
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
