import { describe, it, expect } from "vitest";
import { parseDashboard, readDashboardFile } from "./dashboard-file";
import type { Dashboard } from "./dashboards";

/** A minimal File-like stub whose text() resolves to `content` (no jsdom File needed). */
function fileOf(content: string): File {
  return { text: () => Promise.resolve(content) } as unknown as File;
}

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

  it("carries a valid refreshMs and drops a negative one", () => {
    expect(parseDashboard({ name: "D", widgets: [], refreshMs: 60000 }).refreshMs).toBe(60000);
    expect(parseDashboard({ name: "D", widgets: [], refreshMs: -1 }).refreshMs).toBeUndefined();
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

describe("readDashboardFile", () => {
  it("parses a valid dashboard from an uploaded file", async () => {
    const d = await readDashboardFile(fileOf(JSON.stringify(valid)));
    expect(d).toEqual(valid);
  });

  it("rejects a non-JSON upload with a friendly error", async () => {
    await expect(readDashboardFile(fileOf("not json {"))).rejects.toThrow(/valid JSON/);
  });

  it("strips prototype-pollution keys at the upload seam (safeParseJson), leaving the global prototype clean", async () => {
    // A crafted upload that would pollute Object.prototype if merged after a raw JSON.parse.
    const payload = '{"name":"D","widgets":[],"constructor":{"prototype":{"polluted":"yes"}},"__proto__":{"polluted":"yes"}}';
    const d = await readDashboardFile(fileOf(payload));
    expect(d.name).toBe("D");
    // The dangerous keys never reach the parsed object, so nothing pollutes the prototype.
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
