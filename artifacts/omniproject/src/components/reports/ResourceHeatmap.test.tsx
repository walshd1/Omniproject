import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import {
  getGetProjectCapacityQueryKey,
  type ResourceCapacity,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ResourceHeatmap } from "./ResourceHeatmap";

const PROJECT = "proj-1";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

const ROWS: ResourceCapacity[] = [
  {
    resourceId: "r1",
    resourceName: "Ada Lovelace",
    role: "Engineer",
    allocationPercentage: 120,
    assignedHours: 48,
    availableHours: 40,
    utilizationState: "over_allocated" as ResourceCapacity["utilizationState"],
  },
  {
    resourceId: "r2",
    resourceName: "Grace Hopper",
    role: "Architect",
    allocationPercentage: 90,
    assignedHours: 36,
    availableHours: 40,
    utilizationState: "optimal" as ResourceCapacity["utilizationState"],
  },
];

describe("ResourceHeatmap", () => {
  it("renders a row per resource with allocation and hours", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectCapacityQueryKey(PROJECT), ROWS);
    renderWithProviders(<ResourceHeatmap projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Resource Allocation")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText("120%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("48h / 40h")).toBeInTheDocument();
  });

  it("flags over-allocated resources with a header summary", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectCapacityQueryKey(PROJECT), ROWS);
    renderWithProviders(<ResourceHeatmap projectId={PROJECT} />, { client: qc });

    // One resource is over 100% allocated.
    expect(screen.getByText("1 over-allocated")).toBeInTheDocument();
    expect(screen.getByText("Over")).toBeInTheDocument();
  });

  it("shows the empty-state dependency note when there is no capacity data", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectCapacityQueryKey(PROJECT), []);
    renderWithProviders(<ResourceHeatmap projectId={PROJECT} />, { client: qc });

    expect(screen.getByText(/No capacity data/i)).toBeInTheDocument();
    expect(screen.getByText("get_resource_capacity")).toBeInTheDocument();
  });

  it("renders an error alert with retry when the query fails", async () => {
    const qc = makeClient();
    renderWithProviders(<ResourceHeatmap projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
