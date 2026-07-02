import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionPlanCard } from "./ActionPlanCard";
import type { ActionPlan } from "../lib/nl-action";

/**
 * Shared plan-review card used by every NL→action entry point (command palette, copilot
 * chat). One renderer — these tests pin its three states and the run-on-click contract that
 * both callers rely on for their own confirm gates.
 */
describe("ActionPlanCard", () => {
  it("renders a read action with a Run button", () => {
    const plan: ActionPlan = { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false };
    const onRun = vi.fn();
    render(<ActionPlanCard plan={plan} busy={false} onRun={onRun} />);
    expect(screen.getByTestId("nl-plan-action")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("nl-run"));
    expect(onRun).toHaveBeenCalledWith(plan);
  });

  it("renders a write action with the amber write badge and confirm label", () => {
    const plan: ActionPlan = { kind: "action", tool: "omniproject_update_issue", action: "update_issue", args: { issueId: "42" }, write: true };
    render(<ActionPlanCard plan={plan} busy={false} onRun={vi.fn()} />);
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.getByTestId("nl-run")).toHaveTextContent(/confirm & run \(write\)/i);
  });

  it("renders a clarify question", () => {
    render(<ActionPlanCard plan={{ kind: "clarify", question: "Which project?" }} busy={false} onRun={vi.fn()} />);
    expect(screen.getByTestId("nl-clarify")).toHaveTextContent("Which project?");
  });

  it("renders a none verdict with the reason", () => {
    render(<ActionPlanCard plan={{ kind: "none", reason: "no tool fits" }} busy={false} onRun={vi.fn()} />);
    expect(screen.getByTestId("nl-none")).toHaveTextContent("no tool fits");
  });

  it("namespaces testids with a custom prefix so two instances can coexist", () => {
    const plan: ActionPlan = { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false };
    render(<ActionPlanCard plan={plan} busy={false} onRun={vi.fn()} testIdPrefix="copilot" />);
    expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-run")).toBeInTheDocument();
  });
});
