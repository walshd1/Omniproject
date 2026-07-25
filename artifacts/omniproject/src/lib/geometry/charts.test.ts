import { describe, it, expect } from "vitest";
import { buildColumnChart, buildSparkline } from "./charts";
import type { GeometryShape } from "../../components/geometry/GeometryCanvas";

const of = (shapes: GeometryShape[], type: string) => shapes.filter((s) => s.type === type);

describe("buildColumnChart (a bar chart composed from atoms)", () => {
  const data = [
    { label: "A", value: 10 },
    { label: "B", value: 20 },
    { label: "C", value: 0 },
  ];

  it("emits one rect bar per positive datum, a baseline, gridlines and labels — all atoms", () => {
    const shapes = buildColumnChart({ data, width: 200, height: 100 });
    // Only line / rect / text atoms.
    expect(new Set(shapes.map((s) => s.type))).toEqual(new Set(["line", "rect", "text"]));
    // A and B are positive → 2 bars; C is zero → no rect.
    expect(of(shapes, "rect")).toHaveLength(2);
    // A category label per datum (3) plus the y tick labels.
    expect(of(shapes, "text").length).toBeGreaterThanOrEqual(3);
  });

  it("scales bar heights to the value axis (taller value ⇒ taller bar)", () => {
    const shapes = buildColumnChart({ data, width: 200, height: 100, gridlines: false });
    const rects = of(shapes, "rect");
    const heights = rects.map((r) => Number(r["height"]));
    // B (20) is twice A (10), so its bar is taller.
    expect(heights[1]!).toBeGreaterThan(heights[0]!);
    // No negative rects ever.
    expect(heights.every((h) => h >= 0)).toBe(true);
  });

  it("omits gridlines when asked", () => {
    const withGrid = buildColumnChart({ data, width: 200, height: 100, gridlines: true });
    const noGrid = buildColumnChart({ data, width: 200, height: 100, gridlines: false });
    expect(of(withGrid, "line").length).toBeGreaterThan(of(noGrid, "line").length);
  });
});

describe("buildSparkline (a trend composed from atoms)", () => {
  it("joins consecutive values with line segments (n-1 for n points)", () => {
    const shapes = buildSparkline({ values: [1, 3, 2, 5], width: 100, height: 20 });
    expect(of(shapes, "line")).toHaveLength(3);
  });

  it("marks vertices with point atoms when asked", () => {
    const shapes = buildSparkline({ values: [1, 2, 3], width: 100, height: 20, showPoints: true });
    expect(of(shapes, "point")).toHaveLength(3);
  });

  it("renders a single centred point for one value and nothing for none", () => {
    expect(of(buildSparkline({ values: [5], width: 100, height: 20 }), "point")).toHaveLength(1);
    expect(buildSparkline({ values: [], width: 100, height: 20 })).toEqual([]);
  });
});
