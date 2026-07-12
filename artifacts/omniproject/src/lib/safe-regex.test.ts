import { describe, it, expect } from "vitest";
import { isSafePattern, compileSafe, safeSearch, MAX_PATTERN_LENGTH } from "./safe-regex";

describe("safe-regex (client)", () => {
  it("accepts ordinary patterns and a single quantified char-class", () => {
    for (const p of ["^[A-Z]+$", "\\d{4}", "foo|bar", "[a-z]+", "(ab)+"]) expect(isSafePattern(p)).toBe(true);
  });

  it("rejects the nested-quantifier ReDoS shape, over-long, and invalid patterns", () => {
    expect(isSafePattern("(a+)+")).toBe(false);
    expect(isSafePattern("(.*)*")).toBe(false);
    expect(isSafePattern("[")).toBe(false);
    expect(isSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1))).toBe(false);
  });

  it("compileSafe returns null for an unsafe pattern, a RegExp otherwise", () => {
    expect(compileSafe("(a+)+")).toBeNull();
    expect(compileSafe("^ok$")?.test("ok")).toBe(true);
  });

  it("safeSearch is case-insensitive and never throws", () => {
    expect(safeSearch("apollo", "Project Apollo")).toBe(true);
    expect(safeSearch("(a+)+", "anything")).toBe(false);
  });
});
