import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldControl, type Decision } from "./FieldControl";

/**
 * The decision→field seam at runtime: the decision's TYPE decides which control the field renders and
 * with what options. These tests pin each type to its control and the value it emits.
 */
function renderField(decision: Decision, value = "") {
  const onChange = vi.fn();
  render(<FieldControl label="Setting" decision={decision} value={value} onChange={onChange} />);
  return onChange;
}

describe("FieldControl (decision type drives the control)", () => {
  it("boolean → a toggle switch that flips on/off", () => {
    const onChange = renderField({ type: "boolean" }, "off");
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith("on");
  });

  it("single-choice → a select of the decision's options", () => {
    const onChange = renderField({ type: "single-choice", options: ["low", "medium", "high"] }, "low");
    const select = screen.getByRole("combobox");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["low", "medium", "high"]);
    fireEvent.change(select, { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("multi-choice → a checkbox per option, emitting the comma-joined set", () => {
    const onChange = renderField({ type: "multi-choice", options: ["a", "b", "c"] }, "a");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    fireEvent.click(screen.getByLabelText("b"));
    expect(onChange).toHaveBeenCalledWith("a,b");
  });

  it("number → a numeric input", () => {
    const onChange = renderField({ type: "number" }, "3");
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("text → a text input", () => {
    const onChange = renderField({ type: "text" }, "hi");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "there" } });
    expect(onChange).toHaveBeenCalledWith("there");
  });

  it("label → display-only, no control", () => {
    render(<FieldControl label="Section header" decision={{ type: "label" }} />);
    expect(screen.getByText("Section header")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("falls back to the decision's default value when uncontrolled", () => {
    render(<FieldControl label="S" decision={{ type: "single-choice", options: ["x", "y"], value: "y" }} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("y");
  });

  it("strips unsafe characters on EVERY keystroke — tag delimiters never enter free text", () => {
    const onChange = renderField({ type: "text" }, "");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "<b>hi" } });
    expect(onChange).toHaveBeenCalledWith("bhi"); // '<' and '>' stripped live
  });

  it("commits the fully-sanitised whole string on Enter", () => {
    const onChange = renderField({ type: "text" }, "");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", target: { value: "  hi there  " } });
    expect(onChange).toHaveBeenCalledWith("hi there"); // trimmed on commit
  });

  it("commits the sanitised whole string on blur", () => {
    const onChange = renderField({ type: "text" }, "");
    fireEvent.blur(screen.getByRole("textbox"), { target: { value: "  hello  " } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("validates against the decision's rules and surfaces the error live", () => {
    render(<FieldControl label="Email" decision={{ type: "text", validation: { pattern: "^[^@\\s]+@[^@\\s]+$", patternMessage: "must be an email" } }} value="" onChange={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Email must be an email");
  });
});
