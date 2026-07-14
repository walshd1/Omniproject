import { describe, it, expect } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getListResourcePoolQueryKey,
  type Capabilities,
  type ResourceMember,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { Resources } from "./Resources";

function client(
  entities: Record<string, { surface: boolean; store: boolean }>,
  pool: ResourceMember[] = [],
): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: "demo", entities } as unknown as Capabilities);
  qc.setQueryData(getListResourcePoolQueryKey(), pool);
  return qc;
}

describe("Resources", () => {
  it("explains the gap when the backend can't surface members", () => {
    renderWithProviders(<Resources />, {
      client: client({ member: { surface: false, store: false } }),
    });
    expect(screen.getByText(/isn't available for this backend/i)).toBeInTheDocument();
    expect(screen.queryByText("Person")).toBeNull();
  });

  it("renders the roster with utilisation and over-allocation highlighting", () => {
    const pool = [
      { id: "u1", name: "Ada", email: null, skills: ["react", "node"], availableHours: 40, allocatedHours: 50, projectIds: ["p1", "p2"] },
      { id: "u2", name: "Grace", email: null, skills: [], availableHours: 40, allocatedHours: 20, projectIds: ["p1"] },
    ] as ResourceMember[];
    renderWithProviders(<Resources />, {
      client: client({ member: { surface: true, store: false } }, pool),
    });
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("2 PEOPLE")).toBeInTheDocument();
    // Ada is over-allocated: 50/40 = 125%.
    const over = screen.getByText("125%");
    expect(over).toBeInTheDocument();
    expect(over.className).toMatch(/text-red-500/);
    // Grace is comfortable: 20/40 = 50%.
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  const mixedPool = [
    { id: "u1", name: "Ada", email: null, skills: [], availableHours: 40, allocatedHours: 50, projectIds: ["p1"] }, // 125% over
    { id: "u2", name: "Bob", email: null, skills: [], availableHours: 40, allocatedHours: 38, projectIds: ["p1"] }, // 95% at
    { id: "u3", name: "Grace", email: null, skills: [], availableHours: 40, allocatedHours: 20, projectIds: ["p1"] }, // 50% under
  ] as ResourceMember[];

  it("surfaces over-capacity and at-threshold counts", () => {
    renderWithProviders(<Resources />, { client: client({ member: { surface: true, store: false } }, mixedPool) });
    const summary = screen.getByTestId("capacity-summary");
    expect(within(summary).getByText(/1 over capacity/)).toBeInTheDocument();
    expect(within(summary).getByText(/1 at\/over 90%/)).toBeInTheDocument(); // Bob at 95%
  });

  it("can filter to only the flagged people", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Resources />, { client: client({ member: { surface: true, store: false } }, mixedPool) });
    expect(screen.getByText("Grace")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Only show flagged"));
    // Over (Ada) + at (Bob) stay; under (Grace) is hidden.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).toBeNull();
  });

  it("shows an empty-state row when nobody is found", () => {
    renderWithProviders(<Resources />, {
      client: client({ member: { surface: true, store: false } }, []),
    });
    expect(screen.getByText(/No people found/i)).toBeInTheDocument();
  });

  it("re-computes the at/over count when the capacity level threshold changes", () => {
    renderWithProviders(<Resources />, { client: client({ member: { surface: true, store: false } }, mixedPool) });
    const summary = screen.getByTestId("capacity-summary");
    // At 90%, only Bob (95%) is flagged as at (Ada is separately "over").
    expect(within(summary).getByText(/1 at\/over 90%/)).toBeInTheDocument();
    // Drop the level to 50 → Grace (50%) now also clears the bar, so the at count rises to 2.
    fireEvent.change(screen.getByLabelText("Capacity level threshold"), { target: { value: "50" } });
    expect(within(summary).getByText(/2 at\/over 50%/)).toBeInTheDocument();
    // Ada (125%) stays counted as over regardless of the threshold.
    expect(within(summary).getByText(/1 over capacity/)).toBeInTheDocument();
  });

  it("clamps the threshold input into the 50–150 range", () => {
    renderWithProviders(<Resources />, { client: client({ member: { surface: true, store: false } }, mixedPool) });
    const input = screen.getByLabelText("Capacity level threshold") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    expect(input.value).toBe("150"); // clamped to the ceiling
    fireEvent.change(input, { target: { value: "10" } });
    expect(input.value).toBe("50"); // clamped to the floor
  });

  it("shows the 'nobody at or over' row when the flagged filter hides everyone", () => {
    const calmPool = [
      { id: "u1", name: "Ada", email: null, skills: [], availableHours: 40, allocatedHours: 20, projectIds: ["p1"] }, // 50%
      { id: "u2", name: "Bob", email: null, skills: [], availableHours: 40, allocatedHours: 24, projectIds: ["p1"] }, // 60%
    ] as ResourceMember[];
    renderWithProviders(<Resources />, { client: client({ member: { surface: true, store: false } }, calmPool) });
    fireEvent.click(screen.getByLabelText("Only show flagged"));
    // Nobody is at/over 90% → the flagged-only table shows the reassurance row, not a data row.
    expect(screen.getByText(/Nobody is at or over 90%/i)).toBeInTheDocument();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("surfaces an error with a retry control when the roster query fails", async () => {
    // Member surfacing supported but the pool query is left unseeded → the generated hook fetches
    // and fails in jsdom (no base URL), driving the DataState error surface.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: "demo", entities: { member: { surface: true, store: false } } } as unknown as Capabilities);
    renderWithProviders(<Resources />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry); // exercises the DataState onRetry → refetch()
    expect(retry).toBeInTheDocument();
  });
});
