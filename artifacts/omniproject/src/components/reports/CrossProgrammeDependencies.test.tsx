import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { CrossProgrammeDependencies } from "./CrossProgrammeDependencies";

const FX: FxRates = { base: "GBP", rates: { GBP: 1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
const issue = (o: Partial<Issue> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", ...o } as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("CrossProgrammeDependencies", () => {
  it("shows the empty state when no dependencies are linked", () => {
    renderWithProviders(<CrossProgrammeDependencies />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1" })] }) });
    expect(screen.getByTestId("cross-programme-empty")).toBeInTheDocument();
  });

  it("derives the graph and flags a cross-programme dependency", () => {
    renderWithProviders(<CrossProgrammeDependencies />, {
      client: seed(
        [
          project({ id: "pa", programmeId: "P1", programmeName: "Platform" }),
          project({ id: "pb", programmeId: "P2", programmeName: "Payments" }),
        ],
        {
          pa: [issue({ id: "a", projectId: "pa", title: "Build API", startDate: "2026-01-01", dueDate: "2026-01-03" })],
          pb: [issue({ id: "b", projectId: "pb", title: "Integrate", startDate: "2026-01-04", dueDate: "2026-01-06", customFields: { dependsOn: "a" } })],
        },
      ),
    });
    expect(screen.getByTestId("cross-programme-map")).toBeInTheDocument();
    // One dependency, and it crosses a programme boundary.
    expect(screen.getByTestId("cross-programme-count")).toHaveTextContent("1");
    expect(screen.getByTestId("cross-programme-edge-a-b")).toBeInTheDocument();
    // The critical chain spans both items.
    expect(screen.getByTestId("cross-programme-chain")).toHaveTextContent("Build API");
    expect(screen.getByTestId("cross-programme-chain")).toHaveTextContent("Integrate");
  });

  it("labels a standalone endpoint of a cross-programme dependency and lists it in the rows", () => {
    renderWithProviders(<CrossProgrammeDependencies />, {
      client: seed(
        [
          project({ id: "pa" }), // standalone (no programme)
          project({ id: "pb", programmeId: "P2", programmeName: "Payments" }),
        ],
        {
          pa: [issue({ id: "a", projectId: "pa", title: "Groundwork", startDate: "2026-01-01", dueDate: "2026-01-03" })],
          pb: [issue({ id: "b", projectId: "pb", title: "Integrate", startDate: "2026-01-04", dueDate: "2026-01-06", customFields: { dependsOn: "a" } })],
        },
      ),
    });
    // A null → P2 edge still crosses a boundary; the null side reads "Standalone".
    const edge = screen.getByTestId("cross-programme-edge-a-b");
    expect(edge).toHaveTextContent("Standalone");
    expect(edge).toHaveTextContent("Payments");
    // Both endpoints appear in the per-item table; the standalone one shows "Standalone" as its programme.
    expect(screen.getByTestId("cross-programme-row-a")).toHaveTextContent("Standalone");
  });

  it("surfaces an error with a retry control when the projects query fails", async () => {
    renderWithProviders(<CrossProgrammeDependencies />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry); // exercises DataState onRetry → refetch()
    expect(retry).toBeInTheDocument();
  });

  it("renders a cycle warning without hanging", () => {
    renderWithProviders(<CrossProgrammeDependencies />, {
      client: seed([project({ id: "pa", programmeId: "P1" })], {
        pa: [
          issue({ id: "a", projectId: "pa", customFields: { dependsOn: "b" } }),
          issue({ id: "b", projectId: "pa", customFields: { dependsOn: "a" } }),
        ],
      }),
    });
    expect(screen.getByTestId("cross-programme-cycle")).toBeInTheDocument();
  });
});
