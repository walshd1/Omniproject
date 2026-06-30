import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectCapacityQueryKey, type Project, type ResourceCapacity } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { CapacityRollup } from "./CapacityRollup";

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "P1", source: "jira", ...over } as Project;
}
function res(over: Partial<ResourceCapacity> = {}): ResourceCapacity {
  return { resourceId: "r", resourceName: "x", role: "eng", allocationPercentage: 80, assignedHours: 32, availableHours: 40, ...over } as ResourceCapacity;
}

function seed(projects: Project[], capacity: Record<string, ResourceCapacity[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  for (const [id, caps] of Object.entries(capacity)) qc.setQueryData(getGetProjectCapacityQueryKey(id), caps);
  return qc;
}

describe("CapacityRollup", () => {
  it("rolls up programme + portfolio utilisation across projects", () => {
    renderWithProviders(<CapacityRollup />, {
      client: seed(
        [
          project({ id: "a", name: "A", programmeId: "prog-1", programmeName: "Platform" }),
          project({ id: "b", name: "B", programmeId: "prog-1", programmeName: "Platform" }),
        ],
        {
          a: [res({ assignedHours: 40, availableHours: 40, allocationPercentage: 100 })],
          b: [res({ assignedHours: 20, availableHours: 40, allocationPercentage: 50 })],
        },
      ),
    });
    expect(screen.getByTestId("capacity-rollup")).toBeInTheDocument();
    expect(screen.getByTestId("capacity-rollup-row-prog-1")).toHaveTextContent("75%"); // 60/80
  });

  it("flags over-allocation in the portfolio total", () => {
    renderWithProviders(<CapacityRollup />, {
      client: seed([project({ id: "a", programmeId: "hot", programmeName: "Hot" })], { a: [res({ assignedHours: 60, availableHours: 40, allocationPercentage: 150 })] }),
    });
    const row = screen.getByTestId("capacity-rollup-row-hot");
    expect(row).toHaveTextContent("150%");
  });

  it("shows the empty state when no project reports capacity", () => {
    renderWithProviders(<CapacityRollup />, { client: seed([project({ id: "a" })], { a: [] }) });
    expect(screen.getByTestId("capacity-rollup-empty")).toBeInTheDocument();
  });
});
