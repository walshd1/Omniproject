import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";

/**
 * Burndown computes the active sprint's committed / completed / remaining story points from the SAME live
 * issue data the Scrum board uses. Here we feed it fixed issues and assert the totals.
 */
const issues = [
  { id: "1", title: "A", status: "in_progress", priority: "medium", labels: ["sp:5"] },
  { id: "2", title: "B", status: "done", priority: "medium", labels: ["sprint:s1", "sp:3"] }, // in sprint (explicit) + done
  { id: "3", title: "C", status: "backlog", priority: "low", labels: [] }, // not in sprint
];

vi.mock("@workspace/api-client-react", () => ({
  useGetProjectIssues: () => ({ data: issues, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../../store/useStore", () => ({ useStore: (sel: (s: { activeProjectId: string }) => unknown) => sel({ activeProjectId: "proj-1" }) }));

const { BurndownScreen } = await import("./BurndownScreen");

describe("BurndownScreen", () => {
  it("computes committed / completed / remaining from sprint story points", () => {
    renderWithProviders(<BurndownScreen />);
    expect(screen.getByTestId("burndown-screen")).toBeTruthy();
    // committed = 5 + 3 = 8, completed = 3, remaining = 5, items = 2 (issue 3 is backlog)
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });
});
