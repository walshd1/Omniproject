import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("exposes the expected hrefs in order", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual([
      "/",
      "/programmes",
      "/projects",
      "/reports",
      "/settings",
      "/setup",
    ]);
  });

  it("every item carries an i18nKey, label and icon", () => {
    for (const item of NAV_ITEMS) {
      expect(item.i18nKey).toMatch(/^nav\./);
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTypeOf("object");
      expect(item.match).toBeTypeOf("function");
    }
  });

  it("hrefs and i18nKeys are unique", () => {
    expect(new Set(NAV_ITEMS.map((n) => n.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((n) => n.i18nKey)).size).toBe(NAV_ITEMS.length);
  });

  it("dashboard matches only the exact root path", () => {
    const dash = NAV_ITEMS.find((n) => n.href === "/")!;
    expect(dash.match("/")).toBe(true);
    expect(dash.match("/projects")).toBe(false);
  });

  it("prefix items match their subroutes", () => {
    const projects = NAV_ITEMS.find((n) => n.href === "/projects")!;
    expect(projects.match("/projects")).toBe(true);
    expect(projects.match("/projects/123")).toBe(true);
    expect(projects.match("/")).toBe(false);
    expect(projects.match("/programmes")).toBe(false);
  });

  it("only some items expose a chord hint", () => {
    const chords = NAV_ITEMS.filter((n) => n.chord).map((n) => [n.href, n.chord]);
    expect(chords).toEqual([
      ["/", "G+D"],
      ["/projects", "G+P"],
      ["/reports", "G+R"],
      ["/settings", "G+S"],
    ]);
    expect(NAV_ITEMS.find((n) => n.href === "/programmes")!.chord).toBeUndefined();
  });
});
