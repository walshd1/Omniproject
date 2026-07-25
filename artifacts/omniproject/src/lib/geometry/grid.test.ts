import { describe, it, expect } from "vitest";
import { buildGrid } from "./grid";

/**
 * The grid is the first proof that a drawable composes purely from geometry atoms: buildGrid emits a
 * list of `line` atom instances at intervals — no bespoke SVG. These tests pin the atom output; the
 * render is covered by GeometryCanvas's own tests (a grid is just its `line`s).
 */
describe("buildGrid (a grid as line atoms at intervals)", () => {
  it("emits horizontal + vertical lines at each interval, boundaries included", () => {
    const shapes = buildGrid({ width: 100, height: 100, rowGap: 25, colGap: 50 });
    // Everything is a line atom.
    expect(shapes.every((s) => s.type === "line")).toBe(true);
    // 100/25 → offsets 0,25,50,75,100 = 5 horizontals; 100/50 → 0,50,100 = 3 verticals.
    const horizontals = shapes.filter((s) => s["y1"] === s["y2"]);
    const verticals = shapes.filter((s) => s["x1"] === s["x2"]);
    expect(horizontals).toHaveLength(5);
    expect(verticals).toHaveLength(3);
    // Horizontals span the full width; verticals the full height.
    expect(horizontals.every((s) => s["x1"] === 0 && s["x2"] === 100)).toBe(true);
    expect(verticals.every((s) => s["y1"] === 0 && s["y2"] === 100)).toBe(true);
  });

  it("applies one per-instance style to every gridline (whole grid restyles from the spec)", () => {
    const shapes = buildGrid({ width: 60, height: 30, rowGap: 15, colGap: 15, stroke: "#e5e7eb", thickness: 0.5, dash: "2 2" });
    for (const s of shapes) {
      expect(s["stroke"]).toBe("#e5e7eb");
      expect(s["thickness"]).toBe(0.5);
      expect(s["dash"]).toBe("2 2");
    }
  });

  it("omits an axis whose gap is missing or non-positive (no lines, no infinite loop)", () => {
    // Only vertical lines requested.
    const vOnly = buildGrid({ width: 40, height: 40, colGap: 20 });
    expect(vOnly.every((s) => s["x1"] === s["x2"])).toBe(true);
    expect(vOnly).toHaveLength(3); // 0, 20, 40
    // A zero/negative gap yields nothing rather than looping forever.
    expect(buildGrid({ width: 40, height: 40, rowGap: 0, colGap: -5 })).toEqual([]);
  });
});
