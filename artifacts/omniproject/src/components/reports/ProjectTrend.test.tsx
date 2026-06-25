import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import {
  getGetProjectHistoryQueryKey,
  getGetProjectBaselineQueryKey,
  type ProjectHistoryPoint,
  type ProjectBaseline,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ProjectTrend } from "./ProjectTrend";

const PROJECT = "proj-1";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

const POINTS: ProjectHistoryPoint[] = [
  { date: "2026-01-01", completionRate: 20, totalIssues: 10, completedIssues: 2, provenance: "sourced" },
  { date: "2026-02-01", completionRate: 55, totalIssues: 10, completedIssues: 5, provenance: "sourced" },
  { date: "2026-03-01", completionRate: 80, totalIssues: 10, completedIssues: 8, provenance: "sourced" },
];

const BASELINE: ProjectBaseline = {
  projectId: PROJECT,
  name: "Approved baseline",
  capturedAt: "2026-01-15T00:00:00.000Z",
  items: [
    { issueId: "i1", title: "A" },
    { issueId: "i2", title: "B" },
  ],
  provenance: "sourced",
};

describe("ProjectTrend", () => {
  it("renders the trend summary with point count and latest completion", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectHistoryQueryKey(PROJECT), POINTS);
    renderWithProviders(<ProjectTrend projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Progress Trend")).toBeInTheDocument();
    expect(screen.getByText(/3 points · latest 80% complete/)).toBeInTheDocument();
    // Provenance badge derived from the first point.
    expect(screen.getByText("LIVE · BACKEND")).toBeInTheDocument();
  });

  it("shows baseline details when a baseline is present", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectHistoryQueryKey(PROJECT), POINTS);
    qc.setQueryData(getGetProjectBaselineQueryKey(PROJECT), BASELINE);
    renderWithProviders(<ProjectTrend projectId={PROJECT} />, { client: qc });

    expect(screen.getByText(/Baseline:/)).toBeInTheDocument();
    expect(screen.getByText(/2 items/)).toBeInTheDocument();
  });

  it("notes when no baseline has been captured", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectHistoryQueryKey(PROJECT), POINTS);
    qc.setQueryData(getGetProjectBaselineQueryKey(PROJECT), null);
    renderWithProviders(<ProjectTrend projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("No baseline captured by the backend")).toBeInTheDocument();
  });

  it("shows the empty-state when there is no history", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectHistoryQueryKey(PROJECT), []);
    renderWithProviders(<ProjectTrend projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("No history available from the backend.")).toBeInTheDocument();
  });

  it("renders an error alert with retry when history fails", async () => {
    const qc = makeClient();
    renderWithProviders(<ProjectTrend projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
