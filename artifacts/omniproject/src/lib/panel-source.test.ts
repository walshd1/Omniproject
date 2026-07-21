import { describe, it, expect } from "vitest";
import { resolveSourceUrl } from "./panel-source";

/** Generic panel source-URL templating — a JSON artifact binds a scoped endpoint via `{projectId}` etc. */
describe("resolveSourceUrl", () => {
  it("fills a known token and reports resolved", () => {
    const r = resolveSourceUrl("/api/projects/{projectId}/wbs/cost-rows", { projectId: "proj-001" });
    expect(r).toEqual({ url: "/api/projects/proj-001/wbs/cost-rows", unresolved: false });
  });

  it("url-encodes the substituted value", () => {
    expect(resolveSourceUrl("/x/{projectId}", { projectId: "a/b c" }).url).toBe("/x/a%2Fb%20c");
  });

  it("flags unresolved when a token has no value (so the panel can hold off fetching)", () => {
    const r = resolveSourceUrl("/api/projects/{projectId}/wbs/cost-rows", { projectId: undefined });
    expect(r.unresolved).toBe(true);
    expect(r.url).toContain("{projectId}");
  });

  it("leaves a URL with no tokens untouched", () => {
    expect(resolveSourceUrl("/api/budget-plans/rows", {})).toEqual({ url: "/api/budget-plans/rows", unresolved: false });
  });
});
