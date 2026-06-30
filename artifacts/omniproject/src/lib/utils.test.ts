import { describe, it, expect } from "vitest";
import { cn, truncateLabel } from "./utils";

describe("truncateLabel", () => {
  it("leaves short labels untouched", () => {
    expect(truncateLabel("Short")).toBe("Short");
  });
  it("truncates with an ellipsis past the max", () => {
    expect(truncateLabel("x".repeat(30))).toBe(`${"x".repeat(21)}…`);
    expect(truncateLabel("abcdef", 4)).toBe("abc…");
  });
});

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("flattens arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("returns empty string for no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(false, null)).toBe("");
  });
});
