import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { stakeholdersQueryKey, type Stakeholder } from "../../lib/stakeholders";
import { StakeholdersAdmin } from "./StakeholdersAdmin";

function seed(role: string | undefined, s: Stakeholder[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(stakeholdersQueryKey, s);
  return qc;
}
afterEach(() => vi.restoreAllMocks());

describe("StakeholdersAdmin", () => {
  it("hides below manager", () => {
    renderWithProviders(<StakeholdersAdmin />, { client: seed("viewer") });
    expect(screen.queryByTestId("stakeholders-admin")).not.toBeInTheDocument();
  });
  it("PUTs a cleaned stakeholder", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<StakeholdersAdmin />, { client: seed("manager") });
    fireEvent.click(screen.getByTestId("stakeholder-add"));
    fireEvent.change(screen.getByLabelText("Stakeholder 1 name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByTestId("stakeholders-save"));
    const put = await waitFor(() => { const c = f.mock.calls.find(([u, i]) => u === "/api/stakeholders" && (i as RequestInit)?.method === "PUT"); expect(c).toBeTruthy(); return c!; });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { stakeholders: Stakeholder[] };
    expect(body.stakeholders[0]).toMatchObject({ name: "Ada", influence: "medium", interest: "medium" });
  });
});
