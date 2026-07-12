import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StyleEditor } from "./StyleEditor";
import type { StyleSpec } from "../../lib/artifact-style";

describe("StyleEditor", () => {
  it("emits a spec with the edited title", () => {
    const onChange = vi.fn();
    render(<StyleEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-title"), { target: { value: "Velocity" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "Velocity" });
  });

  it("selects a font and merges it onto the existing spec", () => {
    const onChange = vi.fn();
    render(<StyleEditor value={{ title: "T" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-font"), { target: { value: "serif" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "T", fontFamily: "serif" });
  });

  it("collapses to undefined when the last field is cleared", () => {
    const onChange = vi.fn();
    const value: StyleSpec = { title: "Only title" };
    render(<StyleEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-title"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("clears a colour via its clear button", () => {
    const onChange = vi.fn();
    render(<StyleEditor value={{ background: "#eeeeee" }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("style-bg-color-clear"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("honours a custom id prefix (multiple editors on a page)", () => {
    render(<StyleEditor value={undefined} onChange={vi.fn()} idPrefix="report-3-style" />);
    expect(screen.getByTestId("report-3-style-editor")).toBeInTheDocument();
  });
});
