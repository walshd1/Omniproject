import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { governanceRulesQueryKey, featuresQueryKey, type GovernanceRule, type FeatureStatus } from "../../lib/features";
import { GovernanceRulesAdmin } from "./GovernanceRulesAdmin";

const FEATURES: FeatureStatus[] = [
  { id: "report:evm", kind: "report", label: "Earned Value", description: "", enabled: true, loaded: true, needsRestart: false },
  { id: "grid", kind: "module", label: "Grid", description: "", enabled: true, loaded: true, needsRestart: false },
];

function seed(role: string | undefined, rules: GovernanceRule[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(governanceRulesQueryKey, rules);
  qc.setQueryData(featuresQueryKey(), FEATURES);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("GovernanceRulesAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<GovernanceRulesAdmin />, { client: seed("manager", []) });
    expect(screen.queryByTestId("governance-rules-admin")).not.toBeInTheDocument();
  });

  it("shows the empty state with no rules", () => {
    renderWithProviders(<GovernanceRulesAdmin />, { client: seed("pmo", []) });
    expect(screen.getByTestId("governance-rules-empty")).toBeInTheDocument();
  });

  it("restricts predicate fields to the sync-safe set", () => {
    const rule: GovernanceRule = { id: "no-evm-internal", when: { all: [{ field: "projectType", op: "eq", value: "internal" }] }, forbid: ["report:evm"] };
    renderWithProviders(<GovernanceRulesAdmin />, { client: seed("pmo", [rule]) });
    const fieldSelect = screen.getByLabelText("gov-0 condition 1 field") as HTMLSelectElement;
    const opts = Array.from(fieldSelect.options).map((o) => o.value).filter(Boolean);
    expect(opts).toEqual(["programmeId", "projectId", "projectType"]); // no budget/projection
  });

  it("saves a conditional forbid rule", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ governanceRules: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const rule: GovernanceRule = { id: "no-evm-internal", when: { all: [{ field: "projectType", op: "eq", value: "internal" }] }, forbid: ["report:evm"] };
    renderWithProviders(<GovernanceRulesAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ governance rule"));
    // edit the seeded blank rule's id, then re-seed an effect by selecting in the forbid list
    fireEvent.change(screen.getByLabelText("Governance rule 1 id"), { target: { value: "no-evm-internal" } });
    fireEvent.click(screen.getByText("+ condition"));
    fireEvent.change(screen.getByLabelText("gov-0 condition 1 field"), { target: { value: "projectType" } });
    fireEvent.change(screen.getByLabelText("gov-0 condition 1 value"), { target: { value: "internal" } });
    const forbid = screen.getByLabelText("Governance rule 1 forbid items") as HTMLSelectElement;
    Array.from(forbid.options).find((o) => o.value === "report:evm")!.selected = true;
    fireEvent.change(forbid);
    fireEvent.click(screen.getByText("Save governance rules"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/features/governance-rules")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/features/governance-rules")!;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.governanceRules[0]).toMatchObject({ id: "no-evm-internal", forbid: ["report:evm"], when: { all: [{ field: "projectType", op: "eq", value: "internal" }] } });
    void rule;
  });
});
