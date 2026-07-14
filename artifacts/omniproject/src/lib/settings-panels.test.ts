import { describe, it, expect } from "vitest";
import { SETTINGS_PANEL_KEYS, settingsPanelLabel, settingsAnchorId } from "./settings-panels";
import { ADMIN_PANEL_KEYS } from "../pages/Settings";

describe("settings-panels (palette ↔ Settings drift guard)", () => {
  it("SETTINGS_PANEL_KEYS matches the Settings page's ADMIN_PANELS exactly, in order", () => {
    // If a panel is added/removed/reordered on the page but not here (or vice versa), the palette
    // would offer a dead jump or miss a panel — this keeps the ≤2-actions coverage honest.
    expect([...SETTINGS_PANEL_KEYS]).toEqual(ADMIN_PANEL_KEYS);
  });

  it("every offered panel resolves to a stable anchor id", () => {
    for (const key of SETTINGS_PANEL_KEYS) {
      expect(settingsAnchorId(key)).toBe(`set-${key}`);
    }
  });

  it("derives acronym-aware human labels", () => {
    expect(settingsPanelLabel("aiProviders")).toBe("AI Providers");
    expect(settingsPanelLabel("nlCommand")).toBe("NL Command");
    expect(settingsPanelLabel("guidAliases")).toBe("GUID Aliases");
    expect(settingsPanelLabel("rateCard")).toBe("Rate Card");
    expect(settingsPanelLabel("governanceDashboard")).toBe("Governance Dashboard");
  });
});
