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
});
