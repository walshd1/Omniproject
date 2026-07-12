import { describe, it, expect } from "vitest";
import { baselineReportsForScope } from "./CustomReportsPanel";

describe("baselineReportsForScope", () => {
  it("returns the shipped portfolio report artifact and none for a scope with no baseline", () => {
    const portfolio = baselineReportsForScope("portfolio");
    expect(portfolio.map((a) => a.id)).toContain("builtin.open-issues-by-priority");
    expect(portfolio.every((a) => a.kind === "report" && a.builtin === true)).toBe(true);
    // No baseline report ships for the project scope in the folder today.
    expect(baselineReportsForScope("project")).toEqual([]);
  });
});
