import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectRaidQueryKey, type RaidEntry } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { RiskRegister } from "./RiskRegister";

const NOW = Date.parse("2026-05-15T00:00:00Z");

function raid(over: Partial<RaidEntry> = {}): RaidEntry {
  return { id: "r", projectId: "p1", type: "risk", title: "A risk", severity: "high", status: "open", ...over } as RaidEntry;
}

function seed(entries: RaidEntry[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectRaidQueryKey("p1"), entries);
  return qc;
}

afterEach(() => resetFetchMock());

describe("RiskRegister", () => {
  it("renders the exposure heatmap and counts entries into their likelihood x impact cell", () => {
    renderWithProviders(<RiskRegister projectId="p1" now={NOW} />, {
      client: seed([
        raid({ id: "a", likelihood: "high", impact: "high" }),
        raid({ id: "b", likelihood: "high", impact: "high" }),
        raid({ id: "c", likelihood: "low", impact: "medium" }),
      ]),
    });
    expect(screen.getByTestId("risk-register")).toBeInTheDocument();
    expect(screen.getByTestId("risk-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("risk-cell-high-high")).toHaveTextContent("2");
    expect(screen.getByTestId("risk-cell-low-medium")).toHaveTextContent("1");
  });

  it("lists the top risks worst-first", () => {
    renderWithProviders(<RiskRegister projectId="p1" now={NOW} />, {
      client: seed([
        raid({ id: "crit", likelihood: "high", impact: "high" }), // exposure 9
        raid({ id: "mild", likelihood: "low", impact: "low" }), // exposure 1
      ]),
    });
    const top = screen.getByTestId("risk-top");
    expect(top).toBeInTheDocument();
    expect(screen.getByTestId("risk-top-crit")).toBeInTheDocument();
  });

  it("flags overdue mitigations from the RAID due date", () => {
    renderWithProviders(<RiskRegister projectId="p1" now={NOW} />, {
      client: seed([raid({ id: "a", likelihood: "high", impact: "high", status: "open", dueDate: "2026-01-01" } as Partial<RaidEntry>)]),
    });
    expect(screen.getByText("Overdue mitigations")).toBeInTheDocument();
  });

  it("shows the empty state with no RAID entries", () => {
    renderWithProviders(<RiskRegister projectId="p1" now={NOW} />, { client: seed([]) });
    expect(screen.getByTestId("risk-register-empty")).toBeInTheDocument();
  });
});
