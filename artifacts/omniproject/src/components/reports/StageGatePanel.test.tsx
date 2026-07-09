import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageGatePanel } from "./StageGatePanel";
import { initialGateState, type Lifecycle } from "../../lib/stage-gate";

const lifecycle: Lifecycle = [
  { id: "g1", name: "Idea", criteria: [{ id: "c1", label: "Business case" }], minApprovals: 1 },
  { id: "g2", name: "Plan", criteria: [{ id: "c2", label: "Plan" }], minApprovals: 1 },
];

describe("StageGatePanel", () => {
  it("shows the gate ladder and the current gate's criteria", () => {
    render(<StageGatePanel lifecycle={lifecycle} state={initialGateState()} />);
    expect(screen.getByTestId("gate-chip-g1")).toBeInTheDocument();
    expect(screen.getByTestId("gate-criterion-c1")).toHaveTextContent("Business case");
    expect(screen.getByTestId("stage-gate-status")).toHaveTextContent("Gate 1 of 2");
  });

  it("disables Go until criteria are met and approvals reached", () => {
    const { rerender } = render(<StageGatePanel lifecycle={lifecycle} state={initialGateState()} />);
    expect(screen.getByTestId("gate-decide-go")).toBeDisabled();
    rerender(<StageGatePanel lifecycle={lifecycle} state={initialGateState()} metCriterionIds={["c1"]} approvals={[{ by: "a", verdict: "go" }]} />);
    expect(screen.getByTestId("gate-decide-go")).toBeEnabled();
  });

  it("emits the verdict on a decision", () => {
    const onDecide = vi.fn();
    render(<StageGatePanel lifecycle={lifecycle} state={initialGateState()} onDecide={onDecide} />);
    fireEvent.click(screen.getByTestId("gate-decide-hold"));
    expect(onDecide).toHaveBeenCalledWith("hold");
  });

  it("shows terminal status for a killed project (no current gate controls)", () => {
    const killed = { currentGateIndex: 0, status: "killed" as const, history: [] };
    render(<StageGatePanel lifecycle={lifecycle} state={killed} />);
    expect(screen.getByTestId("stage-gate-status")).toHaveTextContent("killed");
    expect(screen.queryByTestId("gate-decide-go")).not.toBeInTheDocument();
  });
});
