import { describe, it, expect } from "vitest";
import { componentLibrary, componentsFor } from "@workspace/backend-catalogue";
import { resolveLibraryComponent } from "./component-library";

describe("resolveLibraryComponent", () => {
  it("resolves every content-surface component to a real renderer or null (surfaced-via only)", () => {
    for (const c of componentsFor("content")) {
      const resolved = resolveLibraryComponent(c);
      // Only surfaced-via / custom-engine components are allowed to resolve to null.
      if (resolved === null) {
        expect(c.renderer.surfacedVia || c.renderer.engine === "custom").toBeTruthy();
      } else {
        expect(typeof resolved).toBe("function");
      }
    }
  });

  it("bridges both registries: a report component and a widget component both resolve", () => {
    const report = componentLibrary().find((c) => c.source === "report" && !c.renderer.surfacedVia && c.renderer.engine === "builtin")!;
    const widget = componentLibrary().find((c) => c.source === "widget")!;
    expect(resolveLibraryComponent(report)).toBeTypeOf("function");
    expect(resolveLibraryComponent(widget)).toBeTypeOf("function");
  });

  it("returns null for a surfaced-via component and an unregistered one", () => {
    expect(resolveLibraryComponent({ renderer: { engine: "builtin", registry: "report", surfacedVia: "view" } })).toBeNull();
    expect(resolveLibraryComponent({ renderer: { engine: "builtin", registry: "widget", component: "notAThing" } })).toBeNull();
  });
});
