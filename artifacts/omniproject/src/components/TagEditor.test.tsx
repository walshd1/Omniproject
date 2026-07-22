import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagEditor } from "./TagEditor";
import { useTagPrefs } from "../lib/use-tag-prefs";

/**
 * TagEditor — the per-user tag colour + hierarchy controls. Covers the empty guard, colour choice
 * (persisted to the store), the reset affordance, and setting a parent (the hierarchy path shows).
 */
describe("TagEditor", () => {
  beforeEach(() => { localStorage.clear(); useTagPrefs.getState().reset(); });

  it("renders nothing when there are no tags", () => {
    const { container } = render(<TagEditor tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each unique tag with a colour picker and a parent selector", () => {
    render(<TagEditor tags={["work", "work", "home"]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2); // deduped
    expect(screen.getByLabelText("Colour for work")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent tag for home")).toBeInTheDocument();
  });

  it("choosing a colour persists it to the tag-prefs store", () => {
    render(<TagEditor tags={["work"]} />);
    fireEvent.change(screen.getByLabelText("Colour for work"), { target: { value: "#ff0000" } });
    expect(useTagPrefs.getState().prefs["work"]?.color).toBe("#ff0000");
  });

  it("setting a parent records the hierarchy and shows the path", () => {
    render(<TagEditor tags={["parent", "child"]} />);
    fireEvent.change(screen.getByLabelText("Parent tag for child"), { target: { value: "parent" } });
    expect(useTagPrefs.getState().prefs["child"]?.parent).toBe("parent");
    expect(screen.getByText("parent › child")).toBeInTheDocument();
  });

  it("reset clears a chosen colour", () => {
    useTagPrefs.getState().setTag("work", { color: "#123456" });
    render(<TagEditor tags={["work"]} />);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(useTagPrefs.getState().prefs["work"]?.color).toBeUndefined();
  });
});
