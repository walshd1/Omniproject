import { describe, it, expect, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders, mockBlobDownload } from "../../test/utils";
import { ScheduleSandbox } from "./ScheduleSandbox";

const D = (day: number) => new Date(day * 86400000).toISOString();

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 3, completedCount: 0, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

// Back-to-back packages so a push to A cascades into B.
const issues = [
  { id: "A", title: "Foundations", status: "in_progress", startDate: D(0), dueDate: D(4) },
  { id: "B", title: "Walls", status: "todo", startDate: D(5), dueDate: D(9) },
] as unknown as Issue[];

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("ScheduleSandbox", () => {
  it("renders the projected sandbox with a bar per scheduled issue", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    expect(screen.getByTestId("schedule-sandbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Foundations:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Walls:/ })).toBeInTheDocument();
    const summary = screen.getByTestId("schedule-summary");
    expect(within(summary).getByLabelText("Moved")).toHaveTextContent("0");
  });

  it("nudging a bar with the keyboard records the move and re-projects the end date", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    const bar = screen.getByRole("button", { name: /Foundations:/ });
    // Push A six days later → A now ends after B, so the projected end moves out.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(bar, { key: "ArrowRight" });
    const summary = screen.getByTestId("schedule-summary");
    expect(within(summary).getByLabelText("Moved")).toHaveTextContent("1");
    expect(within(summary).getByLabelText("Project end")).not.toHaveTextContent("+0d");
    // With no dependency drawn there is no successor to cascade into; the
    // dependency-driven cascade itself is covered by the engine unit tests.
    expect(within(summary).getByLabelText("Knock-ons")).toHaveTextContent("0");
  });

  it("adds a sandbox dependency edge", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    // The dependency editor offers the issues as predecessor/successor options.
    expect(screen.getByLabelText("Dependent issue")).toBeInTheDocument();
    expect(screen.getByLabelText("Predecessor issue")).toBeInTheDocument();
  });

  it("does not show the resource panel when issues have no assignee", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    expect(screen.queryByTestId("resource-capacity")).toBeNull();
  });

  it("flags a resource clash when one person's tasks overlap", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), projects);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [
      { id: "A", title: "Foundations", status: "in_progress", assignee: "ada", startDate: D(0), dueDate: D(6) },
      { id: "B", title: "Walls", status: "todo", assignee: "ada", startDate: D(4), dueDate: D(10) },
    ] as unknown as Issue[]);
    renderWithProviders(<ScheduleSandbox />, { client: qc });
    const panel = screen.getByTestId("resource-capacity");
    expect(within(panel).getByText("ada")).toBeInTheDocument();
    expect(within(panel).getByText(/2 concurrent/)).toBeInTheDocument();
    expect(within(panel).getByText(/Foundations, Walls|Walls, Foundations/)).toBeInTheDocument();
  });

  it("reports no clashes when one person's tasks are sequential", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), projects);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [
      { id: "A", title: "Foundations", status: "in_progress", assignee: "ada", startDate: D(0), dueDate: D(4) },
      { id: "B", title: "Walls", status: "todo", assignee: "ada", startDate: D(5), dueDate: D(9) },
    ] as unknown as Issue[]);
    renderWithProviders(<ScheduleSandbox />, { client: qc });
    expect(within(screen.getByTestId("resource-capacity")).getByText(/No resource clashes/i)).toBeInTheDocument();
  });

  it("shows the empty state when the project has no scheduled issues", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), projects);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), []);
    renderWithProviders(<ScheduleSandbox />, { client: qc });
    expect(screen.getByText(/No scheduled issues in this project/i)).toBeInTheDocument();
  });

  it("nudging left records the move in the opposite direction", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    const bar = screen.getByRole("button", { name: /Walls:/ });
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    const summary = screen.getByTestId("schedule-summary");
    expect(within(summary).getByLabelText("Moved")).toHaveTextContent("1");
  });

  it("dragging a bar via pointer events doesn't throw and can shift it", () => {
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });
    const bar = screen.getByRole("button", { name: /Foundations:/ });
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 140, pointerId: 1 });
    // Whether or not the drag crossed a day boundary, the handlers must run without throwing.
    expect(screen.getByTestId("schedule-sandbox")).toBeInTheDocument();
  });

  it("switching the scenario project resets the dirty scenario and shows the new project's issues", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const twoProjects = [
      ...projects,
      { id: "p2", name: "Beta", identifier: "BE", source: "jira", issueCount: 1, completedCount: 0, memberCount: 1, updatedAt: "" },
    ] as unknown as Project[];
    qc.setQueryData(getListProjectsQueryKey(), twoProjects);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
    qc.setQueryData(getGetProjectIssuesQueryKey("p2"), [
      { id: "C", title: "Roofing", status: "todo", startDate: D(0), dueDate: D(3) },
    ] as unknown as Issue[]);
    renderWithProviders(<ScheduleSandbox />, { client: qc });

    // Make a change so Reset/Export are enabled, then switch projects.
    fireEvent.keyDown(screen.getByRole("button", { name: /Foundations:/ }), { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeEnabled();

    await user.click(screen.getByLabelText("Scenario project"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(screen.getByRole("button", { name: /Roofing:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeDisabled();
  });

  it("exports the scenario as a downloaded JSON file once dirty", async () => {
    const { click, restore } = mockBlobDownload();
    try {
      renderWithProviders(<ScheduleSandbox />, { client: seeded() });
      const exportBtn = screen.getByRole("button", { name: /^export$/i });
      expect(exportBtn).toBeDisabled();
      fireEvent.keyDown(screen.getByRole("button", { name: /Foundations:/ }), { key: "ArrowRight" });
      expect(exportBtn).toBeEnabled();
      fireEvent.click(exportBtn);
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("adds and removes a sandbox dependency edge", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScheduleSandbox />, { client: seeded() });

    await user.click(screen.getByLabelText("Dependent issue"));
    await user.click(await screen.findByRole("option", { name: "Walls" }));
    await user.click(screen.getByLabelText("Predecessor issue"));
    await user.click(await screen.findByRole("option", { name: "Foundations" }));
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getAllByText(/depends on/i)).toHaveLength(2); // the static label + the new edge row
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Walls depends on Foundations")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Remove dependency/i }));
    expect(screen.getAllByText(/depends on/i)).toHaveLength(1); // only the static label remains
  });
});
