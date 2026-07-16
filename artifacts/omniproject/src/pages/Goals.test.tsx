import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { goalsKey, type GoalMeta } from "../lib/goals";
import { Goals } from "./Goals";

/** The Goals page: list rendering, empty state, and the create-form toggle. Data-layer hooks are covered
 *  by the server route tests; here we check the page wires the list + create surface. */
function seed(goals: GoalMeta[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(goalsKey(), goals);
  return qc;
}
const meta = (over: Partial<GoalMeta> = {}): GoalMeta => ({
  id: "user~g~1", title: "Grow adoption", status: "on_track", progressPct: 40,
  keyResultCount: 2, checkInCount: 1, lastCheckInAt: "2026-01-08", linkCount: 0, updatedAt: "2026-01-08T00:00:00Z", ...over,
});

describe("Goals page", () => {
  it("renders a row per goal with its progress and status", () => {
    renderWithProviders(<Goals />, { client: seed([meta(), meta({ id: "user~g~2", title: "Ship v2", progressPct: 90, status: "at_risk" })]) });
    expect(screen.getByTestId("goal-row-user~g~1")).toHaveTextContent("Grow adoption");
    expect(screen.getByTestId("goal-row-user~g~1")).toHaveTextContent("40%");
    expect(screen.getByTestId("goal-row-user~g~2")).toHaveTextContent("Ship v2");
  });

  it("shows the empty state when there are no goals", () => {
    renderWithProviders(<Goals />, { client: seed([]) });
    expect(screen.getByText(/No goals yet/i)).toBeInTheDocument();
  });

  it("toggles the create form", () => {
    renderWithProviders(<Goals />, { client: seed([]) });
    expect(screen.queryByTestId("goal-create-form")).toBeNull();
    fireEvent.click(screen.getByTestId("goal-new"));
    expect(screen.getByTestId("goal-create-form")).toBeInTheDocument();
    expect(screen.getByTestId("goal-title")).toBeInTheDocument();
    expect(screen.getByTestId("goal-cadence")).toBeInTheDocument();
  });
});
