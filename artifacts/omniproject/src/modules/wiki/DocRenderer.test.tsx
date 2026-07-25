import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocRenderer } from "./DocRenderer";
import type { DocBlock } from "@workspace/backend-catalogue";

/** The read-only document renderer: block types render, wiki-links become spans, nothing is injected as HTML. */
describe("DocRenderer", () => {
  it("renders an empty state when there are no blocks", () => {
    render(<DocRenderer blocks={[]} />);
    expect(screen.getByTestId("doc-empty")).toBeInTheDocument();
  });

  it("renders heading, paragraph and a checklist", () => {
    const blocks: DocBlock[] = [
      { id: "h", type: "heading", level: 1, text: "Runbook" },
      { id: "p", type: "paragraph", text: "Follow the steps." },
      { id: "c", type: "checklist", items: [{ text: "step one", checked: true }, { text: "step two" }] },
    ];
    render(<DocRenderer blocks={blocks} />);
    expect(screen.getByRole("heading", { level: 1, name: "Runbook" })).toBeInTheDocument();
    expect(screen.getByText("Follow the steps.")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
  });

  it("turns [[wiki-links]] into anchored spans with the target", () => {
    render(<DocRenderer blocks={[{ id: "p", type: "paragraph", text: "see [[Onboarding|the guide]] now" }]} />);
    const link = document.querySelector('[data-wikilink="Onboarding"]');
    expect(link).toBeTruthy();
    expect(link!.textContent).toBe("the guide");
  });

  it("does not render authored markup as HTML (text is escaped)", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "p", type: "paragraph", text: "<img src=x onerror=alert(1)>" }]} />);
    // The literal text is present; no <img> element was created from it.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("renders an embed as a safe outbound link, not an inline frame", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "e", type: "embed", url: "https://example.com/x", caption: "Spec" }]} />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("falls back to the url as the embed label when no caption is given", () => {
    render(<DocRenderer blocks={[{ id: "e", type: "embed", url: "https://example.com/spec" }]} />);
    expect(screen.getByText("https://example.com/spec")).toBeInTheDocument();
  });

  it("renders a quote block as a blockquote", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "q", type: "quote", text: "To be." }]} />);
    const quote = container.querySelector("blockquote")!;
    expect(quote).toBeTruthy();
    expect(quote.textContent).toBe("To be.");
  });

  it("renders a code block verbatim inside <pre><code> (never as markup)", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "c", type: "code", text: "<b>x</b> && y" }]} />);
    const code = container.querySelector("pre code")!;
    expect(code.textContent).toBe("<b>x</b> && y");
    expect(container.querySelector("pre b")).toBeNull(); // not parsed as HTML
  });

  it("renders bullet and numbered lists as <ul>/<ol> with their items", () => {
    const { container } = render(
      <DocRenderer
        blocks={[
          { id: "u", type: "bullet-list", items: [{ text: "a" }, { text: "b" }] },
          { id: "o", type: "numbered-list", items: [{ text: "one" }] },
        ]}
      />,
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("renders a divider as an <hr>", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "d", type: "divider" }]} />);
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("renders a table with a cell per column and row", () => {
    const { container } = render(
      <DocRenderer blocks={[{ id: "t", type: "table", rows: [["A", "B"], ["1", "2"]] }]} />,
    );
    expect(container.querySelectorAll("table tr")).toHaveLength(2);
    expect(container.querySelectorAll("table td")).toHaveLength(4);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders a callout in every tone (and defaults an unknown tone to info styling)", () => {
    const { container } = render(
      <DocRenderer
        blocks={[
          { id: "i", type: "callout", tone: "info", text: "fyi" },
          { id: "w", type: "callout", tone: "warn", text: "careful" },
          { id: "s", type: "callout", tone: "success", text: "done" },
          { id: "g", type: "callout", tone: "danger", text: "stop" },
          // Unknown tone must not crash — it falls back to the info class.
          { id: "x", type: "callout", tone: "mystery" as never, text: "huh" },
        ]}
      />,
    );
    expect(container.querySelectorAll(".border-l-4")).toHaveLength(5);
    expect(screen.getByText("careful")).toBeInTheDocument();
    // Unknown-tone callout still renders with the info fallback border class.
    const unknown = screen.getByText("huh").closest("div")!;
    expect(unknown.className).toContain("border-blue-400");
  });

  it("headings above H3 fall back to an <h2>", () => {
    const { container } = render(<DocRenderer blocks={[{ id: "h", type: "heading", level: 5 as never, text: "Big" }]} />);
    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelector("h5")).toBeNull();
  });

  it("renders H3 headings at their own level", () => {
    render(<DocRenderer blocks={[{ id: "h", type: "heading", level: 3, text: "Small" }]} />);
    expect(screen.getByRole("heading", { level: 3, name: "Small" })).toBeInTheDocument();
  });

  it("renders every block type with its optional fields omitted (nullish fallbacks)", () => {
    const { container } = render(
      <DocRenderer
        blocks={[
          { id: "h", type: "heading" },          // no text, no level → h2
          { id: "p", type: "paragraph" },         // no text
          { id: "q", type: "quote" },
          { id: "c", type: "code" },
          { id: "cl", type: "callout" },          // no tone → info fallback
          { id: "u", type: "bullet-list" },       // no items
          { id: "o", type: "numbered-list" },
          { id: "ck", type: "checklist" },
          { id: "t", type: "table" },             // no rows
          { id: "e", type: "embed" },             // no url/caption
        ] as unknown as DocBlock[]}
      />,
    );
    // Empty heading still lands at the default level.
    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelectorAll("ul, ol, table, pre, blockquote").length).toBeGreaterThan(0);
  });

  it("handles wiki-links at the start of text and links without an explicit label", () => {
    render(<DocRenderer blocks={[{ id: "p", type: "paragraph", text: "[[Alpha]] and [[Beta|B]]" }]} />);
    // Leading link with no label uses the target as its text.
    expect(document.querySelector('[data-wikilink="Alpha"]')!.textContent).toBe("Alpha");
    // Second link keeps its explicit label.
    expect(document.querySelector('[data-wikilink="Beta"]')!.textContent).toBe("B");
    // Plain text between the links is preserved.
    expect(screen.getByText(/and/)).toBeInTheDocument();
  });

  it("ignores an unknown block type without crashing the document", () => {
    render(<DocRenderer blocks={[{ id: "z", type: "mystery" } as unknown as DocBlock, { id: "p", type: "paragraph", text: "still here" }]} />);
    expect(screen.getByTestId("doc-renderer")).toBeInTheDocument();
    expect(screen.getByText("still here")).toBeInTheDocument();
  });
});
