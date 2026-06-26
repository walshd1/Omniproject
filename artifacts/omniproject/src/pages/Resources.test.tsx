import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
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
});
