import { describe, it, expect } from "vitest";
import { buildCompositionItems, methodologyLabel } from "./methodology-composition-catalogue";
import { derivePresets } from "./methodology-composition";

describe("buildCompositionItems", () => {
  it("collects items across kinds with unique, kind-prefixed ids", () => {
    const items = buildCompositionItems();
    expect(items.length).toBeGreaterThan(0);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    // Every id is namespaced by kind so a report and a view can't collide.
    expect(ids.every((id) => /^(report|view|screen|output|ruleset|artifact):/.test(id))).toBe(true);
    // Multiple kinds are represented.
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("report")).toBe(true);
    expect(kinds.has("view")).toBe(true);
    expect(kinds.has("ruleset")).toBe(true);
  });

  it("tags rulesets with their own methodology so presets pick them up", () => {
    const items = buildCompositionItems();
    const presets = derivePresets(items, methodologyLabel);
    // There is at least one methodology preset, and each preset lists some items.
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.itemIds.length > 0)).toBe(true);
    // A ruleset item belongs to its own methodology's preset.
    const scrumRuleset = items.find((i) => i.id === "ruleset:scrum");
    if (scrumRuleset) {
      const scrumPreset = presets.find((p) => p.methodology === "scrum");
      expect(scrumPreset?.itemIds).toContain("ruleset:scrum");
    }
  });
});

describe("methodologyLabel", () => {
  it("returns a human label for a known methodology, undefined otherwise", () => {
    expect(typeof methodologyLabel("scrum")).toBe("string");
    expect(methodologyLabel("not-a-methodology")).toBeUndefined();
  });
});
