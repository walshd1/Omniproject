import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { EMPTY_FORM, type FieldPredicate } from "./use-issue-form";
import { FinancialsPanel } from "./FinancialsPanel";

/**
 * The issue dialog's Financials sub-panel: capability-gated visibility/editability per field
 * (showF/editF), each input's value + onChange wiring, and the currency-uppercasing quirk —
 * none of this had a test file at all before.
 */
const allTrue: FieldPredicate = () => true;
const allFalse: FieldPredicate = () => false;

// A real useState-backed harness, matching the convention already used elsewhere (e.g.
// GenerateStep.test.tsx, BackendPicker.test.tsx) for controlled-prop components: the panel's
// onChange closures read `e.target.value` lazily, and a controlled input whose parent never
// actually re-renders gets its DOM value reset by React's controlled-value tracking, so only a
// real round-trip through state proves the onChange wiring.
function Harness(over: { form?: Partial<typeof EMPTY_FORM>; showF?: FieldPredicate; editF?: FieldPredicate } = {}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...over.form });
  return <FinancialsPanel form={form} setForm={setForm} showF={over.showF ?? allTrue} editF={over.editF ?? allTrue} />;
}

describe("FinancialsPanel", () => {
  it("renders nothing when none of its fields are surfaced by the backend", () => {
    const { container } = render(<Harness showF={allFalse} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the section when at least one financial field is surfaced", () => {
    render(<Harness showF={(k) => k === "budget"} />);
    expect(screen.getByText("Financials")).toBeInTheDocument();
    expect(screen.getByLabelText("Budget")).toBeInTheDocument();
    expect(screen.queryByLabelText("Actual cost")).toBeNull();
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.queryByLabelText("Cost centre")).toBeNull();
    expect(screen.queryByLabelText("Billable")).toBeNull();
  });

  it("shows each field's current value and disables it when editF forbids writes", () => {
    render(
      <Harness
        form={{ budget: "1000", actualCost: "250", currency: "gbp", costCenter: "ENG" }}
        editF={(k) => k !== "actualCost"}
      />,
    );
    expect(screen.getByLabelText("Budget")).toHaveValue(1000);
    expect(screen.getByLabelText("Budget")).toBeEnabled();
    expect(screen.getByLabelText("Actual cost")).toHaveValue(250);
    expect(screen.getByLabelText("Actual cost")).toBeDisabled();
    expect(screen.getByLabelText("Currency")).toHaveValue("gbp");
    expect(screen.getByLabelText("Cost centre")).toHaveValue("ENG");
  });

  it("updates the matching form field on change, leaving the rest of the form untouched", () => {
    render(<Harness form={{ actualCost: "999" }} />);
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "500" } });
    expect(screen.getByLabelText("Budget")).toHaveValue(500);
    expect(screen.getByLabelText("Actual cost")).toHaveValue(999); // untouched by the budget edit
  });

  it("updates the actual cost field on change", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "750" } });
    expect(screen.getByLabelText("Actual cost")).toHaveValue(750);
  });

  it("updates the cost centre field on change", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Cost centre"), { target: { value: "ENG-PLAT" } });
    expect(screen.getByLabelText("Cost centre")).toHaveValue("ENG-PLAT");
  });

  it("uppercases the currency as it's typed", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "usd" } });
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });

  it("reflects the billable checkbox state and toggles it on click", () => {
    render(<Harness form={{ billable: true }} />);
    const checkbox = screen.getByLabelText("Billable") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("disables the billable checkbox when editF forbids writes to it", () => {
    render(<Harness editF={(k) => k !== "billable"} />);
    expect(screen.getByLabelText("Billable")).toBeDisabled();
  });
});
