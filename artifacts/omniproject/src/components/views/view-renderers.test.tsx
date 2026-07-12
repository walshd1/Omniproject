import { describe, it, expect } from "vitest";
import { VIEW_RENDERERS, isRegisteredViewRenderer } from "./view-renderers";
import { VIEWS, methodologyViewDefinitions } from "../../lib/views";

/**
 * The view renderer registry is the view-analogue of REPORT_RENDERERS: every built-in (methodology)
 * view is a read-only JSON definition bound to a registered renderer. These guards keep the
 * JSON↔code binding honest and prove the specialized views fold into the unified definition model.
 */
describe("view renderer registry", () => {
  it("binds every catalogue view id to a registered renderer", () => {
    for (const v of VIEWS) expect(isRegisteredViewRenderer(v.id)).toBe(true);
  });

  it("has exactly one renderer per catalogue view id and no extras", () => {
    expect(Object.keys(VIEW_RENDERERS).sort()).toEqual(VIEWS.map((v) => v.id).sort());
  });

  it("rejects an unknown renderer id", () => {
    expect(isRegisteredViewRenderer("nope")).toBe(false);
    expect(isRegisteredViewRenderer(undefined)).toBe(false);
  });
});

describe("methodologyViewDefinitions", () => {
  it("expresses every methodology view as a read-only definition bound to a renderer", () => {
    const defs = methodologyViewDefinitions();
    expect(defs).toHaveLength(VIEWS.length);
    for (const d of defs) {
      expect(d.builtin).toBe(true);
      expect(isRegisteredViewRenderer(d.renderer)).toBe(true);
      expect(["list", "table", "board", "timeline"]).toContain(d.kind);
    }
  });
});
