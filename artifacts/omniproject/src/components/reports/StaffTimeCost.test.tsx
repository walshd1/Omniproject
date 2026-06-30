import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { staffCostQueryKey, type StaffCost } from "../../lib/rate-card";
import { StaffTimeCost } from "./StaffTimeCost";

function staffCost(over: Partial<StaffCost> = {}): StaffCost {
  return {
    internalCost: 0, clientCost: 0, totalCost: 0, charge: 0, margin: 0, unratedHours: 0,
    byTitle: [], projectType: null, columns: [], appliedCostRules: [], ...over,
  };
}

function seed(cost: StaffCost): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(staffCostQueryKey("p1"), cost);
  // Currency is derived from the project's work items.
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [{ id: "i", projectId: "p1", currency: "GBP" } as Issue]);
  return qc;
}

describe("StaffTimeCost", () => {
  it("rolls up true cost, charge and gross margin with the per-role breakdown", () => {
    renderWithProviders(<StaffTimeCost projectId="p1" />, {
      client: seed(staffCost({
        internalCost: 4000, clientCost: 10000, totalCost: 14000, charge: 13000, margin: 3000, unratedHours: 0,
        projectType: "delivery",
        byTitle: [
          { titleHash: "h1", titleLabel: "Senior Engineer", hours: 100, cost: 10000, charge: 13000 },
          { titleHash: "h2", titleLabel: "Internal PMO", hours: 40, cost: 4000, charge: 0 },
        ],
        columns: [
          { id: "cost", label: "True cost", kind: "cost", total: 14000 },
          { id: "charge", label: "Cost to customer", kind: "charge", total: 13000 },
        ],
        appliedCostRules: ["intra-company"],
      })),
    });
    expect(screen.getByTestId("staff-time-cost")).toBeInTheDocument();
    expect(screen.getByTestId("staff-cost-row-h1")).toBeInTheDocument();
    expect(screen.getByTestId("staff-cost-columns")).toBeInTheDocument();
    expect(screen.getByText("30% of client-facing cost")).toBeInTheDocument(); // 3000 / 10000
    expect(screen.getByText(/Cost rules applied: intra-company/)).toBeInTheDocument();
  });

  it("warns when some logged hours have no rate mapping", () => {
    renderWithProviders(<StaffTimeCost projectId="p1" />, {
      client: seed(staffCost({ totalCost: 5000, clientCost: 5000, charge: 5000, unratedHours: 12, byTitle: [{ titleHash: "h1", titleLabel: "Eng", hours: 50, cost: 5000, charge: 5000 }] })),
    });
    expect(screen.getByText("no rate mapped — excluded from cost")).toBeInTheDocument();
  });

  it("shows the empty state when there is no costable time", () => {
    renderWithProviders(<StaffTimeCost projectId="p1" />, { client: seed(staffCost()) });
    expect(screen.getByTestId("staff-cost-empty")).toBeInTheDocument();
  });
});
