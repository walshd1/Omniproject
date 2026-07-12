import { describe, it, expect } from "vitest";
import { isSafePattern, patternMatches, safeSearch, MAX_PATTERN_LENGTH } from "./safe-regex";

describe("safe-regex (client, RE2-backed)", () => {
  it("accepts ordinary patterns AND ones that would ReDoS a backtracking engine", () => {
    for (const p of ["^[A-Z]+$", "\\d{4}", "foo|bar", "[a-z]+", "(a+)+", "(.*)*"]) expect(isSafePattern(p)).toBe(true);
  });

  it("rejects over-long and invalid patterns", () => {
    expect(isSafePattern("[")).toBe(false);
    expect(isSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1))).toBe(false);
  });

  it("patternMatches uses search semantics and stays linear on a ReDoS-shaped input", () => {
    expect(patternMatches("[A-Z]+", "abcABC")).toBe(true);
    expect(patternMatches("^[A-Z]+$", "abc")).toBe(false);
    expect(patternMatches("(a+)+$", "a".repeat(80) + "X")).toBe(false); // native RegExp would hang
  });

  it("safeSearch is case-insensitive and never throws", () => {
    expect(safeSearch("apollo", "Project Apollo")).toBe(true);
    expect(safeSearch("[", "anything")).toBe(false);
  });
});
