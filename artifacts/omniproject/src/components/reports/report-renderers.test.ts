import { describe, it, expect } from "vitest";
import { reportCatalogue, type ReportDefinition } from "@workspace/backend-catalogue";
import { REPORT_RENDERERS, resolveReportRenderer, isRegisteredRenderer } from "./report-renderers";

const def = (renderer: ReportDefinition["renderer"]): Pick<ReportDefinition, "renderer"> => ({ renderer });

describe("report renderer registry", () => {
  it("every built-in catalogue report resolves to a registered renderer", () => {
    const builtins = reportCatalogue().filter((r) => r.renderer.engine === "builtin" && !r.renderer.surfacedVia);
    expect(builtins.length).toBeGreaterThan(0);
    for (const r of builtins) {
      expect(isRegisteredRenderer(r.renderer.component), `${r.id} → ${r.renderer.component}`).toBe(true);
      expect(resolveReportRenderer(r)).toBe(REPORT_RENDERERS[r.renderer.component!]);
    }
  });

  it("no registered renderer is orphaned — every entry is referenced by a report", () => {
    const used = new Set(reportCatalogue().map((r) => r.renderer.component).filter(Boolean));
    for (const name of Object.keys(REPORT_RENDERERS)) expect(used.has(name), `${name} is registered but unused`).toBe(true);
  });

  it("resolves null for a surfaced-via exception and a custom-engine report", () => {
    expect(resolveReportRenderer(def({ engine: "builtin", surfacedVia: "view", reason: "board" }))).toBeNull();
    expect(resolveReportRenderer(def({ engine: "custom" }))).toBeNull();
    expect(resolveReportRenderer(def({ engine: "builtin", component: "NotAThing" }))).toBeNull();
  });
});
