import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { costRulesQueryKey, type CostRule } from "../../lib/rate-card";
import { CostRulesAdmin } from "./CostRulesAdmin";

function seed(role: string | undefined, rules: CostRule[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(costRulesQueryKey, rules);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("CostRulesAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<CostRulesAdmin />, { client: seed("manager", []) });
    expect(screen.queryByTestId("cost-rules-admin")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no rules", () => {
    renderWithProviders(<CostRulesAdmin />, { client: seed("pmo", []) });
    expect(screen.getByTestId("cost-rules-empty")).toBeInTheDocument();
  });

  it("seeds an existing rule with its condition and effect", () => {
    const rule: CostRule = { id: "intra", label: "Intra-company", when: { all: [{ field: "intraCompany", op: "truthy" }] }, effect: { margin: 0 } };
    renderWithProviders(<CostRulesAdmin />, { client: seed("pmo", [rule]) });
    expect(screen.getByTestId("cost-rule-0")).toBeInTheDocument();
    expect(screen.getByLabelText("cost-0 condition 1 field")).toHaveValue("intraCompany");
    expect(screen.getByLabelText("Cost rule 1 margin %")).toHaveValue("0");
  });

  it("removing a middle rule keeps the survivors (stable row keys, not index)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ costRules: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const rules: CostRule[] = [
      { id: "a", effect: { margin: 0.1 } },
      { id: "b", effect: { margin: 0.2 } },
      { id: "c", effect: { margin: 0.3 } },
    ];
    renderWithProviders(<CostRulesAdmin />, { client: seed("pmo", rules) });

    // Remove the middle rule (b) via its Remove button.
    fireEvent.click(screen.getAllByText("Remove")[1]!);
    fireEvent.click(screen.getByText("Save cost rules"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card/cost-rules")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card/cost-rules")!;
    const body = JSON.parse(init.body as string);
    expect(body.costRules.map((r: CostRule) => r.id)).toEqual(["a", "c"]);
  });

  it("builds and saves a new rule with a numeric predicate value", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ costRules: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CostRulesAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ cost rule"));
    fireEvent.click(screen.getByText("+ condition"));
    fireEvent.change(screen.getByLabelText("cost-0 condition 1 field"), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText("cost-0 condition 1 operator"), { target: { value: "gt" } });
    fireEvent.change(screen.getByLabelText("cost-0 condition 1 value"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Cost rule 1 margin %"), { target: { value: "30" } });
    fireEvent.click(screen.getByText("Save cost rules"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rate-card/cost-rules")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/rate-card/cost-rules")!;
    const body = JSON.parse(init.body as string);
    expect(body.costRules).toHaveLength(1);
    expect(body.costRules[0].when.all[0]).toEqual({ field: "budget", op: "gt", value: 100000 }); // numeric, not "100000"
    expect(body.costRules[0].effect.margin).toBeCloseTo(0.3);
  });
});
