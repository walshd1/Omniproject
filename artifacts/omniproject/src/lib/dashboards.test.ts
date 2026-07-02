import { describe, it, expect } from "vitest";
import {
  WIDGET_CATALOGUE,
  widgetDef,
  clampSpan,
  availableWidgets,
  availablePresets,
  presetForRole,
  dashboardFromPreset,
} from "./dashboards";

describe("WIDGET_CATALOGUE", () => {
  it("has unique widget types and non-empty metadata", () => {
    const types = WIDGET_CATALOGUE.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    for (const w of WIDGET_CATALOGUE) {
      expect(w.label).toBeTruthy();
      expect(w.description).toBeTruthy();
      expect([1, 2, 3]).toContain(w.defaultSpan);
    }
  });
});

describe("widgetDef", () => {
  it("resolves a known type and returns undefined for an unknown one", () => {
    expect(widgetDef("portfolioHealth")?.label).toBe("Portfolio health");
    expect(widgetDef("nope")).toBeUndefined();
  });
});

describe("clampSpan", () => {
  it("normalises to the 1–3 grid", () => {
    expect(clampSpan(undefined)).toBe(1);
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(1)).toBe(1);
    expect(clampSpan(2)).toBe(2);
    expect(clampSpan(3)).toBe(3);
    expect(clampSpan(9)).toBe(3);
  });
});

describe("availableWidgets", () => {
  it("drops entity-gated widgets the backend can't surface", () => {
    const without = availableWidgets((entity) => entity !== "programme");
    expect(without.some((w) => w.type === "programmeCount")).toBe(false);
    expect(without.some((w) => w.type === "portfolioHealth")).toBe(true);
  });

  it("keeps every widget when the backend surfaces everything", () => {
    const all = availableWidgets(() => true);
    expect(all.length).toBe(WIDGET_CATALOGUE.length);
  });
});

describe("dashboard presets", () => {
  it("offers a preset per role, tailored to the role", () => {
    const all = availablePresets(() => true);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(presetForRole("head-of-projects")?.role).toBe("head-of-projects");
    expect(presetForRole("nope")).toBeUndefined();
  });

  it("drops a preset needing an entity the backend can't surface", () => {
    const without = availablePresets((entity) => entity !== "programme");
    expect(without.some((p) => p.role === "programme-manager")).toBe(false);
    expect(without.some((p) => p.role === "project-manager")).toBe(true);
  });

  it("materialises a preset into a fresh, persistable dashboard", () => {
    const preset = presetForRole("project-manager")!;
    const dash = dashboardFromPreset(preset);
    expect(dash.id).toBe(""); // caller mints the id
    expect(dash.name).toBe(preset.name);
    expect(dash.widgets.length).toBe(preset.widgets.length);
    // Every placed widget gets a fresh unique id and a resolved span.
    const ids = dash.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of dash.widgets) expect([1, 2, 3]).toContain(w.span);
  });
});
