import { describe, it, expect } from "vitest";
import { splitEntryLines, isMultiLine, MAX_MULTI_ENTRY } from "./multi-entry";

describe("splitEntryLines", () => {
  it("splits on newlines, one item per line", () => {
    expect(splitEntryLines("a\nb\nc").lines).toEqual(["a", "b", "c"]);
  });

  it("trims each line and drops blank lines (incl. trailing/leading/interstitial)", () => {
    expect(splitEntryLines("  a  \n\n b \n\n\n c \n").lines).toEqual(["a", "b", "c"]);
  });

  it("handles CRLF and lone CR line endings", () => {
    expect(splitEntryLines("a\r\nb\rc").lines).toEqual(["a", "b", "c"]);
  });

  it("keeps a single line as one item and preserves inner spaces", () => {
    expect(splitEntryLines("wire the auth callback").lines).toEqual(["wire the auth callback"]);
  });

  it("preserves inline sigils on each line (splitting only, no parsing)", () => {
    expect(splitEntryLines("buy milk #home !p1\ncall dentist @phone ^tomorrow").lines).toEqual([
      "buy milk #home !p1",
      "call dentist @phone ^tomorrow",
    ]);
  });

  it("caps at max and reports the truncated overflow instead of dropping it silently", () => {
    const raw = Array.from({ length: MAX_MULTI_ENTRY + 5 }, (_, i) => `task ${i}`).join("\n");
    const out = splitEntryLines(raw);
    expect(out.lines).toHaveLength(MAX_MULTI_ENTRY);
    expect(out.truncated).toBe(5);
    expect(out.lines[0]).toBe("task 0");
  });

  it("honours a custom max", () => {
    const out = splitEntryLines("a\nb\nc\nd", 2);
    expect(out.lines).toEqual(["a", "b"]);
    expect(out.truncated).toBe(2);
  });

  it("empty / whitespace-only input yields no lines", () => {
    expect(splitEntryLines("").lines).toEqual([]);
    expect(splitEntryLines("   \n\t\n  ").lines).toEqual([]);
  });
});

describe("isMultiLine", () => {
  it("is true only when ≥2 non-blank lines result", () => {
    expect(isMultiLine("a\nb")).toBe(true);
    expect(isMultiLine("a")).toBe(false);
    expect(isMultiLine("a\n\n\n")).toBe(false); // one line of text + blanks → single item
    expect(isMultiLine("")).toBe(false);
  });
});
