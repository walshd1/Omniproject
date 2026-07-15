import { describe, it, expect } from "vitest";
import { getScreenDef, screenDefs } from "./screen-catalogue";

/**
 * The JSON screen catalogue is the trusted boundary between untyped JSON and the ScreenDef model the
 * renderer relies on, so these lock the shape every authored screen must satisfy: a stable id, a label,
 * and panels with a known kind, a unique id and a valid (1–12) span. A malformed screen JSON fails here
 * rather than rendering a broken canvas.
 */
const KNOWN_KINDS = new Set(["metric", "text", "table", "list", "view", "board", "chart", "timeline", "register", "graph", "map", "component"]);

describe("screen catalogue", () => {
  it("exposes at least the budget-plans screen by id", () => {
    expect(getScreenDef("budget-plans")).toBeTruthy();
    expect(getScreenDef("no-such-screen")).toBeUndefined();
  });

  it("has unique screen ids", () => {
    const ids = screenDefs().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every screen has a label and well-formed panels", () => {
    for (const s of screenDefs()) {
      expect(s.id, "screen id").toBeTruthy();
      expect(s.label, `label for ${s.id}`).toBeTruthy();
      expect(Array.isArray(s.panels), `panels for ${s.id}`).toBe(true);
      const panelIds = s.panels.map((p) => p.id);
      expect(new Set(panelIds).size, `unique panel ids in ${s.id}`).toBe(panelIds.length);
      for (const p of s.panels) {
        expect(p.id, `panel id in ${s.id}`).toBeTruthy();
        expect(KNOWN_KINDS.has(p.kind), `panel ${p.id} kind ${p.kind}`).toBe(true);
        if (p.span !== undefined) {
          expect(p.span, `panel ${p.id} span`).toBeGreaterThanOrEqual(1);
          expect(p.span, `panel ${p.id} span`).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it("budget-plans binds its panels to the rows endpoint", () => {
    const budget = getScreenDef("budget-plans")!;
    const urls = budget.panels.map((p) => p.source?.url ?? "");
    expect(urls.every((u) => u.startsWith("/api/budget-plans/rows"))).toBe(true);
  });

  it("resource-allocations binds its panels to the rows endpoint", () => {
    const res = getScreenDef("resource-allocations")!;
    expect(res).toBeTruthy();
    const urls = res.panels.map((p) => p.source?.url ?? "");
    expect(urls.every((u) => u.startsWith("/api/resource-allocations/rows"))).toBe(true);
  });
});
