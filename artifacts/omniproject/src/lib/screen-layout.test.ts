import { describe, it, expect } from "vitest";
import { applyLayout, reorderPanels, type ScreenDef } from "./screen";

/**
 * applyLayout (hide → re-span → reorder) and reorderPanels (the drag move).
 */
const screen: ScreenDef = {
  id: "s", label: "S",
  panels: [
    { id: "a", kind: "metric", config: {} },
    { id: "b", kind: "metric", config: {} },
    { id: "c", kind: "metric", span: 6, config: {} },
  ],
};

describe("applyLayout", () => {
  it("returns the screen unchanged with no layout", () => {
    expect(applyLayout(screen, null)).toBe(screen);
  });

  it("reorders panels by the saved order, keeping unlisted ones after", () => {
    const out = applyLayout(screen, { order: ["c", "a"] });
    expect(out.panels.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("applies per-panel span overrides", () => {
    const out = applyLayout(screen, { spans: { a: 4 } });
    expect(out.panels.find((p) => p.id === "a")!.span).toBe(4);
    expect(out.panels.find((p) => p.id === "c")!.span).toBe(6); // untouched
  });

  it("hides panels listed in hidden", () => {
    const out = applyLayout(screen, { hidden: ["b"] });
    expect(out.panels.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("ignores unknown panel ids and never drops a panel missing from order", () => {
    const out = applyLayout(screen, { order: ["zzz", "b"] });
    expect(out.panels.map((p) => p.id)).toEqual(["b", "a", "c"]); // b first, rest keep order
  });
});

describe("reorderPanels", () => {
  it("moves the dragged id to just before the target", () => {
    expect(reorderPanels(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderPanels(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
  });
  it("is a no-op when dragging onto itself", () => {
    expect(reorderPanels(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });
});
