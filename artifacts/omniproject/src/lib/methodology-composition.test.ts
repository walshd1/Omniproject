import { describe, it, expect } from "vitest";
import {
  derivePresets, isEnabled, isItemVisible, visibleItems, applyPreset, removePreset, toggleItem, itemInMethodology,
  type CompositionItem,
} from "./methodology-composition";

const items: CompositionItem[] = [
  { id: "burndown", kind: "report", label: "Burndown", methodologies: ["scrum"] },
  { id: "velocity", kind: "report", label: "Velocity", methodologies: ["scrum"] },
  { id: "stage-gate", kind: "report", label: "Stage gate", methodologies: ["prince2"] },
  { id: "raid", kind: "view", label: "RAID", methodologies: ["prince2", "safe"] },
  { id: "list", kind: "view", label: "List", methodologies: [] }, // neutral — belongs to every preset
];

describe("derivePresets", () => {
  it("builds one preset per methodology, each including its items + the neutral ones", () => {
    const presets = derivePresets(items, (id) => ({ scrum: "Scrum", prince2: "PRINCE2" }[id]));
    const scrum = presets.find((p) => p.methodology === "scrum")!;
    expect(scrum.label).toBe("Scrum");
    expect(scrum.itemIds.sort()).toEqual(["burndown", "list", "velocity"]); // scrum items + neutral
    const prince2 = presets.find((p) => p.methodology === "prince2")!;
    expect(prince2.itemIds.sort()).toEqual(["list", "raid", "stage-gate"]);
  });
});

describe("visibility", () => {
  it("shows everything when uncurated (null)", () => {
    expect(isEnabled(null, "burndown")).toBe(true);
    expect(visibleItems(items, null)).toHaveLength(items.length);
  });

  it("shows only enabled ids once curated", () => {
    const enabled = ["burndown", "list"];
    expect(isEnabled(enabled, "burndown")).toBe(true);
    expect(isEnabled(enabled, "stage-gate")).toBe(false);
    expect(visibleItems(items, enabled).map((i) => i.id)).toEqual(["burndown", "list"]);
  });
});

describe("presets compose (some Scrum + some PRINCE2)", () => {
  it("first preset curates down; a second preset unions in; then items trim", () => {
    const presets = derivePresets(items);
    const scrum = presets.find((p) => p.methodology === "scrum")!;
    const prince2 = presets.find((p) => p.methodology === "prince2")!;

    // One click Scrum: from all-on, curate to exactly Scrum (+ neutral).
    let enabled = applyPreset(null, scrum);
    expect([...enabled].sort()).toEqual(["burndown", "list", "velocity"]);

    // One click PRINCE2: union it in — now both methodologies' items are on.
    enabled = applyPreset(enabled, prince2);
    expect([...enabled].sort()).toEqual(["burndown", "list", "raid", "stage-gate", "velocity"]);

    // Trim: drop velocity (keep some of Scrum) and stage-gate (keep some of PRINCE2).
    enabled = toggleItem(enabled, items, "velocity");
    enabled = toggleItem(enabled, items, "stage-gate");
    expect([...enabled].sort()).toEqual(["burndown", "list", "raid"]);
  });

  it("removePreset strips only a methodology's own items, keeping neutral ones", () => {
    const scrum = derivePresets(items).find((p) => p.methodology === "scrum")!;
    // From all-on, removing Scrum drops the scrum-tagged items but keeps neutral + other methodologies.
    const enabled = removePreset(null, items, scrum);
    expect(enabled).not.toContain("burndown");
    expect(enabled).not.toContain("velocity");
    expect(enabled).toContain("stage-gate");
    expect(enabled).toContain("list"); // neutral is universal — survives the removal
  });

  it("toggleItem from uncurated turns exactly one thing off", () => {
    const enabled = toggleItem(null, items, "stage-gate");
    expect(enabled).not.toContain("stage-gate");
    expect(enabled).toContain("burndown");
    expect(enabled.length).toBe(items.length - 1);
  });
});

describe("isItemVisible", () => {
  it("builds the kind-namespaced id and reads the composition (null = all visible)", () => {
    expect(isItemVisible(null, "report", "evm")).toBe(true);
    expect(isItemVisible(["report:evm"], "report", "evm")).toBe(true);
    expect(isItemVisible(["report:evm"], "report", "burndown")).toBe(false);
    // Namespacing keeps a report and a view with the same raw id distinct.
    expect(isItemVisible(["view:raid"], "report", "raid")).toBe(false);
  });
});

describe("itemInMethodology", () => {
  it("matches by tag and treats neutral/star as belonging to all", () => {
    expect(itemInMethodology(items[0]!, "scrum")).toBe(true);
    expect(itemInMethodology(items[0]!, "prince2")).toBe(false);
    expect(itemInMethodology(items[4]!, "anything")).toBe(true); // neutral
    expect(itemInMethodology({ id: "x", kind: "output", label: "x", methodologies: ["*"] }, "zzz")).toBe(true);
  });
});
