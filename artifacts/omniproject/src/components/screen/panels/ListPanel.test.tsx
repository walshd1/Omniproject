import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListPanel } from "./ListPanel";
import type { Panel } from "../../../lib/screen";

/**
 * ListPanel — a vertical list of { title, subtitle? } items. Covers the empty state, the
 * title-header toggle, subtitle rendering, and the defensive coercion of malformed config items.
 */
const panel = (config: Record<string, unknown>, title?: string): Panel => ({ id: "l", kind: "list", ...(title ? { title } : {}), config });

describe("ListPanel", () => {
  it("shows the empty message when there are no items", () => {
    render(<ListPanel panel={panel({ items: [] })} />);
    expect(screen.getByText("Nothing to show.")).toBeInTheDocument();
  });

  it("treats a non-array items config as empty", () => {
    render(<ListPanel panel={panel({ items: "not-an-array" })} />);
    expect(screen.getByText("Nothing to show.")).toBeInTheDocument();
  });

  it("renders the title header only when a title is provided", () => {
    const { rerender } = render(<ListPanel panel={panel({ items: [{ title: "A" }] }, "My work")} />);
    expect(screen.getByText("My work")).toBeInTheDocument();
    rerender(<ListPanel panel={panel({ items: [{ title: "A" }] })} />);
    expect(screen.queryByText("My work")).not.toBeInTheDocument();
  });

  it("renders each item's title and its subtitle when present", () => {
    render(<ListPanel panel={panel({ items: [{ title: "Ship it", subtitle: "due today" }, { title: "No sub" }] })} />);
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getByText("due today")).toBeInTheDocument();
    expect(screen.getByText("No sub")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("coerces a missing title to empty and drops a non-string subtitle and non-object entries", () => {
    render(<ListPanel panel={panel({ items: [{ subtitle: 42 }, null, "bad", { title: "Kept" }] })} />);
    // null and the bare string are filtered out; the object with a numeric subtitle survives (title "").
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Kept")).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument(); // numeric subtitle dropped
  });
});
