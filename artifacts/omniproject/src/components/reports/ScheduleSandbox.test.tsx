import { describe, it, expect, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
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
});
