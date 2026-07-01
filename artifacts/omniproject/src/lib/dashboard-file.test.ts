import { describe, it, expect } from "vitest";
import { parseDashboard } from "./dashboard-file";
import type { Dashboard } from "./dashboards";

const valid: Dashboard = {
  id: "ops", name: "Ops board",
  widgets: [
    { id: "w1", type: "portfolioHealth", span: 3 },
    { id: "w2", type: "recentActivity", span: 1, title: "Latest" },
  ],
};

describe("parseDashboard", () => {
  it("round-trips a valid dashboard through JSON", () => {
    expect(parseDashboard(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it("keeps span/title only when present and mints widget ids", () => {
    const d = parseDashboard({ name: "D", widgets: [{ type: "projectCount" }] });
    expect(d.id).toBe("");
    expect(d.widgets[0]).toEqual({ id: "w1", type: "projectCount" });
  });

  it("drops an out-of-range span", () => {
    const d = parseDashboard({ name: "D", widgets: [{ id: "a", type: "x", span: 9 }] });
    expect(d.widgets[0]!.span).toBeUndefined();
  });

  it("rejects a non-object, a missing name, or non-array widgets", () => {
    expect(() => parseDashboard(7)).toThrow(/dashboard/);
    expect(() => parseDashboard({ widgets: [] })).toThrow(/name/);
    expect(() => parseDashboard({ name: "D", widgets: {} })).toThrow(/widgets/);
    expect(() => parseDashboard({ name: "D", widgets: [{}] })).toThrow(/type/);
  });

  it("reconstructs from validated fields, dropping any injected __proto__ key", () => {
    const d = parseDashboard({ name: "D", widgets: [], __proto__: { polluted: true } } as Record<string, unknown>);
    expect((d as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
