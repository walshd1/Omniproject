import { describe, it, expect } from "vitest";
import { SHORTCUT_GROUPS, allShortcuts } from "./shortcuts";

describe("SHORTCUT_GROUPS", () => {
  it("every shortcut has at least one key and a non-empty label", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.heading).toBeTruthy();
      expect(group.items.length).toBeGreaterThan(0);
      for (const s of group.items) {
        expect(s.keys.length).toBeGreaterThan(0);
        expect(s.keys.every((k) => k.length > 0)).toBe(true);
        expect(s.label).toBeTruthy();
      }
    }
  });

  it("labels are unique (no duplicated rows)", () => {
    const labels = allShortcuts().map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("documents the core global shortcuts that the app actually wires up", () => {
    const labels = allShortcuts().map((s) => s.label.toLowerCase());
    expect(labels.some((l) => l.includes("command palette"))).toBe(true); // ⌘/Ctrl+K
    expect(labels.some((l) => l.includes("search"))).toBe(true); // "/"
    expect(labels.some((l) => l.includes("this help"))).toBe(true); // "?"
    expect(labels.some((l) => l.includes("close"))).toBe(true); // Esc
  });

  it("documents the G-chord navigation that the app wires up (incl. Explore)", () => {
    const navKeys = SHORTCUT_GROUPS.find((g) => g.heading === "Navigation")!.items.map((s) => s.keys.join("+"));
    for (const chord of ["G+D", "G+P", "G+R", "G+E", "G+S"]) {
      expect(navKeys).toContain(chord);
    }
  });
});
