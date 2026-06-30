import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectHistoryQueryKey } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { Burndown } from "./Burndown";
import { Burnup } from "./Burnup";
import { CumulativeFlow } from "./CumulativeFlow";
import { Velocity } from "./Velocity";

const HISTORY = [
  { date: "2026-06-01", completionRate: 0, totalIssues: 10, completedIssues: 0, provenance: "sourced" },
  { date: "2026-06-08", completionRate: 30, totalIssues: 10, completedIssues: 3, provenance: "sourced" },
  { date: "2026-06-15", completionRate: 58, totalIssues: 12, completedIssues: 7, provenance: "sourced" },
  { date: "2026-06-22", completionRate: 100, totalIssues: 12, completedIssues: 12, provenance: "sourced" },
];

function seed(history: unknown[] = HISTORY): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectHistoryQueryKey("p1"), history);
  return qc;
}

describe("progress-plane reports", () => {
  it("Burndown renders its chart from history", () => {
    renderWithProviders(<Burndown projectId="p1" />, { client: seed() });
    expect(screen.getByTestId("burndown-chart")).toBeInTheDocument();
  });
  it("Burnup renders its chart from history", () => {
    renderWithProviders(<Burnup projectId="p1" />, { client: seed() });
    expect(screen.getByTestId("burnup-chart")).toBeInTheDocument();
  });
  it("CumulativeFlow renders its chart from history", () => {
    renderWithProviders(<CumulativeFlow projectId="p1" />, { client: seed() });
    expect(screen.getByTestId("cumulative-flow-chart")).toBeInTheDocument();
  });
  it("Velocity renders the chart and the mean throughput line", () => {
    renderWithProviders(<Velocity projectId="p1" />, { client: seed() });
    expect(screen.getByTestId("velocity-chart")).toBeInTheDocument();
    // deltas 3,4,5 → mean 4
    expect(screen.getByText(/Mean 4 completed/)).toBeInTheDocument();
  });
  it("Velocity shows an empty state with too little history", () => {
    renderWithProviders(<Velocity projectId="p1" />, { client: seed([HISTORY[0]]) });
    expect(screen.getByText(/Not enough history/)).toBeInTheDocument();
  });
});
