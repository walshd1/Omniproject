import { describe, it, expect } from "vitest";
import { parseNotes, parseInline, isSafeNoteHref, type NoteBlock } from "./task-notes";

/**
 * task-notes — the pure markdown-lite parser behind the task notes editor. Covers block detection
 * (headings, quotes, code fences, bullet/number/check lists, paragraphs), inline runs (bold, italic,
 * code, links) and the link-scheme allowlist that keeps `javascript:`/`data:` from becoming anchors.
 */
describe("isSafeNoteHref", () => {
  it("allows http, https and mailto only", () => {
    expect(isSafeNoteHref("https://example.com")).toBe(true);
    expect(isSafeNoteHref("http://example.com/x")).toBe(true);
    expect(isSafeNoteHref("mailto:a@b.com")).toBe(true);
  });
  it("rejects javascript:, data:, protocol-relative and bare paths", () => {
    expect(isSafeNoteHref("javascript:alert(1)")).toBe(false);
    expect(isSafeNoteHref("data:text/html,x")).toBe(false);
    expect(isSafeNoteHref("//evil.com")).toBe(false);
    expect(isSafeNoteHref("/relative")).toBe(false);
  });
});

describe("parseInline", () => {
  it("splits bold / italic / code / plain runs in order", () => {
    const spans = parseInline("a **b** c *d* `e`");
    expect(spans).toEqual([
      { t: "text", text: "a " },
      { t: "bold", text: "b" },
      { t: "text", text: " c " },
      { t: "italic", text: "d" },
      { t: "text", text: " " },
      { t: "code", text: "e" },
    ]);
  });
  it("parses a link into text + href", () => {
    const spans = parseInline("see [docs](https://x.dev)");
    expect(spans[1]).toEqual({ t: "link", text: "docs", href: "https://x.dev" });
  });
  it("treats underscores as italic", () => {
    expect(parseInline("_hi_")).toEqual([{ t: "italic", text: "hi" }]);
  });
  it("returns a single empty text run for an empty string", () => {
    expect(parseInline("")).toEqual([{ t: "text", text: "" }]);
  });
});

describe("parseNotes", () => {
  const kinds = (bs: NoteBlock[]) => bs.map((b) => b.t);

  it("detects headings with their level", () => {
    const bs = parseNotes("# Big\n## Med\n### Small");
    expect(bs).toEqual([
      { t: "heading", level: 1, spans: [{ t: "text", text: "Big" }] },
      { t: "heading", level: 2, spans: [{ t: "text", text: "Med" }] },
      { t: "heading", level: 3, spans: [{ t: "text", text: "Small" }] },
    ]);
  });

  it("groups consecutive lines into one paragraph, blank line splits", () => {
    const bs = parseNotes("one\ntwo\n\nthree");
    expect(kinds(bs)).toEqual(["paragraph", "paragraph"]);
    expect((bs[0] as { spans: unknown }).spans).toEqual([{ t: "text", text: "one two" }]);
  });

  it("parses a checklist with checked/unchecked state", () => {
    const bs = parseNotes("- [ ] todo\n- [x] done");
    expect(bs).toHaveLength(1);
    expect(bs[0]).toEqual({
      t: "checks",
      items: [
        { checked: false, spans: [{ t: "text", text: "todo" }] },
        { checked: true, spans: [{ t: "text", text: "done" }] },
      ],
    });
  });

  it("keeps plain bullets separate from checklist items", () => {
    const bs = parseNotes("- plain\n- [x] checked");
    expect(kinds(bs)).toEqual(["bullets", "checks"]);
  });

  it("parses numbered lists", () => {
    const bs = parseNotes("1. first\n2. second");
    expect(bs[0]).toMatchObject({ t: "numbers" });
    expect((bs[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses a fenced code block verbatim", () => {
    const bs = parseNotes("```\nline1\n  line2\n```");
    expect(bs).toEqual([{ t: "code", text: "line1\n  line2" }]);
  });

  it("parses a quote line", () => {
    const bs = parseNotes("> a wise note");
    expect(bs[0]).toEqual({ t: "quote", spans: [{ t: "text", text: "a wise note" }] });
  });

  it("returns no blocks for an empty string", () => {
    expect(parseNotes("")).toEqual([]);
  });
});
