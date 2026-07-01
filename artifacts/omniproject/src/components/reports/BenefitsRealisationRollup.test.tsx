import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { BenefitsRealisationRollup } from "./BenefitsRealisationRollup";

const NOW = Date.parse("2026-05-15");
const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
const issue = (o: Partial<Issue> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

afterEach(() => vi.unstubAllGlobals());

describe("BenefitsRealisationRollup", () => {
  const benefits = {
    a: [
      issue({ id: "1", plannedBenefitValue: 100, actualBenefitValue: 90, benefitStatus: "realised", benefitDueDate: "2026-02-10" }),
      issue({ id: "2", plannedBenefitValue: 300, actualBenefitValue: 0, benefitStatus: "at risk", benefitDueDate: "2026-11-01" }),
    ],
  };

  it("renders the pipeline buckets and realisation headline stats", () => {
    renderWithProviders(<BenefitsRealisationRollup now={NOW} />, { client: seed([project({ id: "a" })], benefits) });
    expect(screen.getByTestId("benefits-realisation")).toBeInTheDocument();
    expect(screen.getByTestId("benefit-bucket-realised")).toBeInTheDocument();
    expect(screen.getByTestId("benefit-bucket-at_risk")).toHaveTextContent("300");
    expect(screen.getByText("At risk / missed")).toBeInTheDocument();
  });

  it("shows the empty state when no project reports benefits", () => {
    renderWithProviders(<BenefitsRealisationRollup now={NOW} />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1" })] }) });
    expect(screen.getByTestId("benefits-realisation-empty")).toBeInTheDocument();
  });

  it("captures a benefits-realisation snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ manifest: { id: "s", scope: "benefits-realisation", label: "x", createdAt: "2026-05-15T00:00:00.000Z", rowCount: 1, contentHash: "h", hashAlgorithm: "sha256" }, data: {} }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { default: userEvent } = await import("@testing-library/user-event");

    renderWithProviders(<BenefitsRealisationRollup now={NOW} />, { client: seed([project({ id: "a" })], benefits) });
    await userEvent.click(screen.getByTestId("snapshot-capture"));

    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/snapshots/capture")!;
    expect(call).toBeTruthy();
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ scope: "benefits-realisation" });
  });
});
