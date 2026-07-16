import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { resourceAllocationsQueryKey, type ResourceAllocation } from "../../lib/resource-allocations";
import { ResourceAllocationsAdmin } from "./ResourceAllocationsAdmin";

function seed(role: string | undefined, allocs: ResourceAllocation[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(resourceAllocationsQueryKey, allocs);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ResourceAllocationsAdmin", () => {
  it("renders nothing below manager", () => {
    renderWithProviders(<ResourceAllocationsAdmin />, { client: seed("contributor", []) });
    expect(screen.queryByTestId("resource-allocations-admin")).not.toBeInTheDocument();
  });

  it("disables Save until an allocation is fully valid", () => {
    renderWithProviders(<ResourceAllocationsAdmin />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("resource-alloc-add"));
    expect(screen.getByTestId("resource-allocations-save")).toBeDisabled(); // resource/project/dates empty
    fireEvent.change(screen.getByLabelText("Allocation 1 resource"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 project"), { target: { value: "proj-1" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 hours"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 start"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 end"), { target: { value: "2026-03-31" } });
    expect(screen.getByTestId("resource-allocations-save")).not.toBeDisabled();
  });

  it("flags an allocation whose end is before its start", () => {
    renderWithProviders(<ResourceAllocationsAdmin />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("resource-alloc-add"));
    fireEvent.change(screen.getByLabelText("Allocation 1 resource"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 project"), { target: { value: "proj-1" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 start"), { target: { value: "2026-03-31" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 end"), { target: { value: "2026-01-01" } });
    expect(screen.getByTestId("resource-allocations-save")).toBeDisabled();
  });

  it("PUTs the cleaned allocations to /api/resource-allocations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ResourceAllocationsAdmin />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("resource-alloc-add"));
    fireEvent.change(screen.getByLabelText("Allocation 1 resource"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 project"), { target: { value: "proj-1" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 hours"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 start"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Allocation 1 end"), { target: { value: "2026-03-31" } });
    fireEvent.click(screen.getByTestId("resource-allocations-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === "/api/resource-allocations" && (init as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { resourceAllocations: ResourceAllocation[] };
    expect(body.resourceAllocations).toHaveLength(1);
    expect(body.resourceAllocations[0]).toMatchObject({ resource: "Ada", projectId: "proj-1", hours: 40, periodStart: "2026-01-01", periodEnd: "2026-03-31" });
  });
});
