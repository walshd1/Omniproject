import { describe, it, expect } from "vitest";
import { hasStyle, resolveStyle, FONT_STACKS, FONT_CHOICES, type StyleSpec } from "./artifact-style";

describe("hasStyle", () => {
  it("is false for undefined", () => {
    expect(hasStyle(undefined)).toBe(false);
  });

  it("is false for an empty spec", () => {
    expect(hasStyle({})).toBe(false);
  });

  it("is false when only non-visible keys (align) are set", () => {
    // `align` is not counted as visible styling — it only positions an existing heading.
    expect(hasStyle({ align: "center" })).toBe(false);
    expect(hasStyle({ align: "left" })).toBe(false);
  });

  it.each<[keyof StyleSpec, string]>([
    ["title", "My chart"],
    ["subtitle", "sub"],
    ["fontFamily", "mono"],
    ["textColor", "#111"],
    ["background", "#fff"],
  ])("is true when %s is set", (key, value) => {
    expect(hasStyle({ [key]: value } as StyleSpec)).toBe(true);
  });

  it("is false when a visible key is present but empty-string (falsy)", () => {
    expect(hasStyle({ title: "", subtitle: "", textColor: "", background: "" })).toBe(false);
  });

  it("narrows the type so a truthy spec is usable as StyleSpec", () => {
    const s: StyleSpec | undefined = { title: "x" };
    if (hasStyle(s)) expect(s.title).toBe("x");
  });
});

describe("resolveStyle", () => {
  it("returns an empty object for undefined", () => {
    expect(resolveStyle(undefined)).toEqual({});
  });

  it("returns an empty object for an empty spec", () => {
    expect(resolveStyle({})).toEqual({});
  });

  it("maps each named font to its concrete CSS stack", () => {
    for (const f of FONT_CHOICES) {
      expect(resolveStyle({ fontFamily: f })).toEqual({ fontFamily: FONT_STACKS[f] });
    }
  });

  it("passes textColor through as color", () => {
    expect(resolveStyle({ textColor: "rebeccapurple" })).toEqual({ color: "rebeccapurple" });
  });

  it("passes background through", () => {
    expect(resolveStyle({ background: "#000" })).toEqual({ background: "#000" });
  });

  it("combines every set key", () => {
    expect(resolveStyle({ fontFamily: "serif", textColor: "#111", background: "#eee" })).toEqual({
      fontFamily: FONT_STACKS.serif,
      color: "#111",
      background: "#eee",
    });
  });

  it("omits keys that are absent or empty-string (does not emit them)", () => {
    const out = resolveStyle({ title: "just a title", textColor: "" });
    expect(out).toEqual({});
    expect("color" in out).toBe(false);
    expect("fontFamily" in out).toBe(false);
    expect("background" in out).toBe(false);
  });

  it("ignores title/subtitle/align (not part of the resolved CSS props)", () => {
    expect(resolveStyle({ title: "t", subtitle: "s", align: "center" })).toEqual({});
  });
});
