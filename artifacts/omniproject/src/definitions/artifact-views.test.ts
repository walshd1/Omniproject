import { describe, it, expect } from "vitest";
import { builtinArtifactViewsFor } from "./artifact-views";

describe("builtinArtifactViewsFor", () => {
  it("adapts the shipped task view artifact into a read-only ViewDefinition", () => {
    const views = builtinArtifactViewsFor("task");
    const chart = views.find((v) => v.id === "builtin.tasks-by-status");
    expect(chart).toBeDefined();
    expect(chart!.builtin).toBe(true);
    expect(chart!.kind).toBe("chart");
    expect(chart!.entity).toBe("task");
    expect(chart!.chart).toEqual({ type: "bar", groupField: "status" });
  });

  it("returns nothing for an entity with no shipped view artifacts", () => {
    expect(builtinArtifactViewsFor("widget")).toEqual([]);
  });
});
