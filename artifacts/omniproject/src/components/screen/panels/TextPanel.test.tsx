import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextPanel } from "./TextPanel";
import type { Panel } from "../../../lib/screen";

/**
 * TextPanel — static prose. Renders `config.text` as plain text (no HTML), with an optional title.
 */
const panel = (config: Record<string, unknown>, title?: string): Panel => ({ id: "t", kind: "text", ...(title ? { title } : {}), config });

describe("TextPanel", () => {
  it("renders the supplied text under its title", () => {
    render(<TextPanel panel={panel({ text: "Read me first" }, "Notes")} />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Read me first")).toBeInTheDocument();
  });

  it("omits the header when no title is set", () => {
    const { container } = render(<TextPanel panel={panel({ text: "Body only" })} />);
    expect(screen.getByText("Body only")).toBeInTheDocument();
    expect(container.querySelector("h3, [class*='CardTitle']")).toBeNull();
  });

  it("renders empty text (no crash) when config.text is missing or not a string", () => {
    const { container } = render(<TextPanel panel={panel({ text: 123 })} />);
    const p = container.querySelector("p");
    expect(p).toBeInTheDocument();
    expect(p).toHaveTextContent(""); // non-string coerced to empty
  });

  it("does not interpret HTML in the text (rendered as plain text)", () => {
    render(<TextPanel panel={panel({ text: "<b>bold?</b>" })} />);
    expect(screen.getByText("<b>bold?</b>")).toBeInTheDocument();
  });
});
