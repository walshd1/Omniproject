import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { budgetPlansQueryKey, type BudgetPlan } from "../../lib/budget-plans";
import { BudgetPlansAdmin } from "./BudgetPlansAdmin";

function seed(role: string | undefined, plans: BudgetPlan[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(budgetPlansQueryKey, plans);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("BudgetPlansAdmin", () => {
  it("renders nothing below manager", () => {
    renderWithProviders(<BudgetPlansAdmin />, { client: seed("contributor", []) });
    expect(screen.queryByTestId("budget-plans-admin")).not.toBeInTheDocument();
  });

  it("shows the editor to a manager", () => {
    renderWithProviders(<BudgetPlansAdmin />, { client: seed("manager", []) });
    expect(screen.getByTestId("budget-plans-admin")).toBeInTheDocument();
    expect(screen.getByTestId("budget-plans-empty")).toBeInTheDocument();
  });

  it("disables Save when a plan has no projectId", () => {
    renderWithProviders(<BudgetPlansAdmin />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("budget-plan-add"));
    // id is auto-filled but projectId is empty → invalid
    expect(screen.getByTestId("budget-plans-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("budget-plan-project-0"), { target: { value: "proj-1" } });
    expect(screen.getByTestId("budget-plans-save")).not.toBeDisabled();
  });

  it("PUTs the cleaned plans (with a period) to /api/budget-plans", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<BudgetPlansAdmin />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("budget-plan-add"));
    fireEvent.change(screen.getByTestId("budget-plan-project-0"), { target: { value: "proj-1" } });
    fireEvent.change(screen.getByTestId("budget-plan-currency-0"), { target: { value: "USD" } });
    fireEvent.click(screen.getByTestId("budget-period-add-0"));
    fireEvent.change(screen.getByLabelText("Plan 1 period 1 label"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Plan 1 period 1 amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("budget-plans-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === "/api/budget-plans" && (init as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { budgetPlans: BudgetPlan[] };
    expect(body.budgetPlans).toHaveLength(1);
    expect(body.budgetPlans[0]!.projectId).toBe("proj-1");
    expect(body.budgetPlans[0]!.currency).toBe("USD");
    expect(body.budgetPlans[0]!.periods).toEqual([{ period: "2026", amount: 500 }]);
  });
});
