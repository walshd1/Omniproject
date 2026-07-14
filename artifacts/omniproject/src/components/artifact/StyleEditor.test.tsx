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

  it("edits the subtitle", () => {
    const onChange = vi.fn();
    render(<StyleEditor value={{ title: "T" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-subtitle"), { target: { value: "Q3 rollup" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "T", subtitle: "Q3 rollup" });
  });

  it("sets centre alignment and clears it back to the default", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StyleEditor value={{ title: "T" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-align"), { target: { value: "center" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "T", align: "center" });
    // Selecting the (default) left option removes the align field again.
    rerender(<StyleEditor value={{ title: "T", align: "center" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-align"), { target: { value: "left" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "T" });
  });

  it("edits the text colour and clears it via its clear button", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StyleEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-text-color"), { target: { value: "#112233" } });
    expect(onChange).toHaveBeenLastCalledWith({ textColor: "#112233" });
    // The clear button appears once a colour is set; clicking it drops the field.
    rerender(<StyleEditor value={{ textColor: "#112233" }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("style-text-color-clear"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("edits the background colour", () => {
    const onChange = vi.fn();
    render(<StyleEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("style-bg-color"), { target: { value: "#fafafa" } });
    expect(onChange).toHaveBeenLastCalledWith({ background: "#fafafa" });
  });
});
