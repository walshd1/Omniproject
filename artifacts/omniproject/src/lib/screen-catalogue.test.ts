import { describe, it, expect } from "vitest";
import { getScreenDef, screenDefs, canonicalLayoutFor, routedScreens, screenCompositionItems, visibleRoutedScreens, mergeScreens, resolveScreenDef, type ScreenCatalogueEntry } from "./screen-catalogue";

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

  it("routed catalogue screens are exposed as methodology composition items", () => {
    const routed = routedScreens().map((s) => s.id);
    expect(routed).toContain("kanban"); // declares a route
    expect(routed).not.toContain("home"); // migrated core page — no catalogue route, keeps its own
    const items = screenCompositionItems();
    const kanban = items.find((i) => i.id === "screen:kanban");
    expect(kanban).toMatchObject({ kind: "screen", methodologies: ["kanban"] });
  });

  it("ships the methodology board screens, each routed and tagged with its methodology", () => {
    const expected: Record<string, string> = { kanban: "kanban", scrum: "scrum", "gantt-board": "waterfall", prince2: "prince2", raid: "governance" };
    for (const [id, methodology] of Object.entries(expected)) {
      const def = getScreenDef(id);
      expect(def, `screen ${id}`).toBeTruthy();
      expect(def!.route, `route for ${id}`).toBeTruthy();
      expect(def!.methodologies, `tags for ${id}`).toContain(methodology);
      // each hosts its board as a view panel
      expect(def!.panels[0]!.kind).toBe("view");
    }
  });

  it("project sub-screens are catalogued for rendering but not re-registered as composition items", () => {
    for (const id of ["gantt", "risk-register", "raci-matrix", "stakeholders"]) {
      const def = getScreenDef(id);
      expect(def, `sub-screen ${id}`).toBeTruthy();
      expect(def!.route, `${id} must not declare a catalogue route (backend owns its composition item)`).toBeUndefined();
    }
    // …so they don't appear in routedScreens / composition items (no collision with the backend screens).
    const routedIds = routedScreens().map((s) => s.id);
    for (const id of ["gantt", "risk-register", "raci-matrix", "stakeholders"]) expect(routedIds).not.toContain(id);
  });

  it("a methodology-tagged screen shows/hides with the composition; neutral screens always show", () => {
    // Uncurated (null) → everything visible.
    expect(visibleRoutedScreens(null).map((s) => s.id)).toContain("kanban");
    // Curated to just Kanban → the kanban-tagged screen is in.
    expect(visibleRoutedScreens(["screen:kanban"]).map((s) => s.id)).toContain("kanban");
    // Curated to something else → the kanban-tagged screen is hidden.
    expect(visibleRoutedScreens(["screen:something-else"]).map((s) => s.id)).not.toContain("kanban");
  });

  it("mergeScreens: an org def overrides a built-in of the same id, and a new id is appended", () => {
    const override: ScreenCatalogueEntry = { id: "budget-plans", label: "Our Budgets", panels: [{ id: "t", kind: "table" }] };
    const brandNew: ScreenCatalogueEntry = { id: "org-only", label: "Org Only", route: "/org-only", panels: [{ id: "x", kind: "text" }] };
    const merged = mergeScreens([override, brandNew]);
    // same count of built-ins (override replaces in place) + 1 appended
    expect(merged.filter((s) => s.id === "budget-plans")).toHaveLength(1);
    expect(merged.find((s) => s.id === "budget-plans")!.label).toBe("Our Budgets"); // overridden
    expect(merged.find((s) => s.id === "org-only")).toBeTruthy(); // appended
    // built-in untouched when no org def targets it
    expect(merged.find((s) => s.id === "resource-allocations")!.label).toBe(getScreenDef("resource-allocations")!.label);
  });

  it("resolveScreenDef: org override wins; falls back to the built-in", () => {
    const override: ScreenCatalogueEntry = { id: "kanban", label: "Team Board", panels: [{ id: "b", kind: "view", config: { view: "kanban" } }] };
    expect(resolveScreenDef("kanban", [override])!.label).toBe("Team Board");
    expect(resolveScreenDef("kanban", [])!.label).toBe(getScreenDef("kanban")!.label); // built-in fallback
    expect(resolveScreenDef("no-such", [])).toBeUndefined();
  });

  it("canonicalLayoutFor returns a methodology's canonical arrangement, or null", () => {
    const budget = getScreenDef("budget-plans")!;
    expect(canonicalLayoutFor(budget, undefined)).toBeNull(); // no active methodology
    expect(canonicalLayoutFor(budget, "no-such")).toBeNull(); // screen ships none for it
    const lean = canonicalLayoutFor(budget, "lean");
    expect(lean).toBeTruthy();
    expect(lean!.hidden).toContain("budget-all-periods");
    // every referenced panel id in the canonical layout must exist on the screen
    const ids = new Set(budget.panels.map((p) => p.id));
    for (const id of [...(lean!.order ?? []), ...(lean!.hidden ?? [])]) expect(ids.has(id)).toBe(true);
  });
});
