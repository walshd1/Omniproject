import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PredicateEditor } from "./PredicateEditor";
import type { Predicate } from "../../lib/rate-card";

/**
 * PredicateEditor is a controlled "when" builder. These tests drive it through a tiny stateful host so
 * onChange actually feeds back into `value`, exercising the add/remove/patch callbacks and the
 * op-dependent value parsing/serialisation.
 */
function Host({ initial = [], fieldOptions }: { initial?: Predicate[]; fieldOptions?: string[] }) {
  const [value, setValue] = useState<Predicate[]>(initial);
  return (
    <div>
      <PredicateEditor idPrefix="t" value={value} onChange={setValue} {...(fieldOptions ? { fieldOptions } : {})} />
      <pre data-testid="state">{JSON.stringify(value)}</pre>
    </div>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent || "[]") as Predicate[];

describe("PredicateEditor", () => {
  it("shows the always-applies hint with no conditions", () => {
    render(<Host />);
    expect(screen.getByText(/this rule always applies/i)).toBeInTheDocument();
  });

  it("adds a free-text condition (default field empty, op eq) then edits the field", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /\+ condition/i }));
    expect(state()).toEqual([{ field: "", op: "eq", value: "" }]);
    fireEvent.change(screen.getByLabelText("t condition 1 field"), { target: { value: "budget" } });
    expect(state()[0]!.field).toBe("budget");
  });

  it("adds a fixed-choice condition seeded with the first field option and edits it via the select", () => {
    render(<Host fieldOptions={["programmeId", "projectType"]} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ condition/i }));
    expect(state()[0]!.field).toBe("programmeId");
    fireEvent.change(screen.getByLabelText("t condition 1 field"), { target: { value: "projectType" } });
    expect(state()[0]!.field).toBe("projectType");
  });

  it("parses a numeric scalar as a number and a non-numeric scalar as a string", () => {
    render(<Host initial={[{ field: "budget", op: "gt", value: "" }]} />);
    const input = screen.getByLabelText("t condition 1 value");
    fireEvent.change(input, { target: { value: "1000" } });
    expect(state()[0]!.value).toBe(1000);
    fireEvent.change(input, { target: { value: "high" } });
    expect(state()[0]!.value).toBe("high");
  });

  it("switching to a unary op drops the value input and clears the stored value", () => {
    render(<Host initial={[{ field: "budget", op: "eq", value: 5 }]} />);
    expect(screen.getByLabelText("t condition 1 value")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("t condition 1 operator"), { target: { value: "truthy" } });
    expect(screen.queryByLabelText("t condition 1 value")).not.toBeInTheDocument();
    expect(state()[0]).toEqual({ field: "budget", op: "truthy", value: undefined });
  });

  it("switching to a non-unary op keeps the value key and parses an array op as a trimmed list", () => {
    render(<Host initial={[{ field: "labels", op: "eq", value: "x" }]} />);
    fireEvent.change(screen.getByLabelText("t condition 1 operator"), { target: { value: "in" } });
    const valueInput = screen.getByLabelText("t condition 1 value") as HTMLInputElement;
    expect(valueInput.placeholder).toBe("a, b, c");
    fireEvent.change(valueInput, { target: { value: "a, 2 , , c" } });
    // Numeric-looking members become numbers, blanks are dropped.
    expect(state()[0]!.value).toEqual(["a", 2, "c"]);
  });

  it("serialises an existing array value back into the input as a comma list", () => {
    render(<Host initial={[{ field: "labels", op: "in", value: ["a", "b"] }]} />);
    expect((screen.getByLabelText("t condition 1 value") as HTMLInputElement).value).toBe("a, b");
  });

  it("renders a stored undefined value as an empty box and a unary predicate with no value box", () => {
    render(<Host initial={[{ field: "x", op: "ne", value: undefined }, { field: "y", op: "falsy", value: undefined }]} />);
    expect((screen.getByLabelText("t condition 1 value") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("t condition 2 value")).not.toBeInTheDocument();
  });

  it("removes a condition row", () => {
    render(<Host initial={[{ field: "a", op: "eq", value: "1" }, { field: "b", op: "eq", value: "2" }]} />);
    expect(screen.getAllByTestId(/^t-pred-/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /t remove condition 1/i }));
    const rows = screen.getAllByTestId(/^t-pred-/);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByLabelText("t condition 1 field")).toHaveValue("b");
  });
});
