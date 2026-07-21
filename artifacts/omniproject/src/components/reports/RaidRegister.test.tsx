import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectRaidQueryKey, type RaidEntry } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { RaidRegister } from "./RaidRegister";

function raid(over: Partial<RaidEntry> = {}): RaidEntry {
  return { id: "r", projectId: "p1", type: "risk", title: "A risk", severity: "high", status: "open", ...over } as RaidEntry;
}

function seed(entries: RaidEntry[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectRaidQueryKey("p1"), entries);
  return qc;
}

describe("RaidRegister", () => {
  it("counts RAID entries by type and reports the open exposure", () => {
    renderWithProviders(<RaidRegister projectId="p1" />, {
      client: seed([
        raid({ id: "a", type: "risk", status: "mitigating" }),
        raid({ id: "b", type: "dependency", status: "open" }),
        raid({ id: "c", type: "issue", status: "closed" }), // closed → not open
      ]),
    });
    expect(screen.getByTestId("raid-register")).toBeInTheDocument();
    expect(screen.getByText(/2 open/)).toBeInTheDocument(); // mitigating + open; done excluded
    expect(screen.getByText(/of 3 total/)).toBeInTheDocument();
  });
  it("breaks entries down by severity, including low", () => {
    renderWithProviders(<RaidRegister projectId="p1" />, {
      client: seed([
        raid({ id: "a", severity: "high", status: "open" }),
        raid({ id: "b", severity: "medium", status: "open" }),
        raid({ id: "c", severity: "low", status: "open" }),
      ]),
    });
    const sev = screen.getByTestId("raid-severity");
    expect(sev).toHaveTextContent("high: 1");
    expect(sev).toHaveTextContent("medium: 1");
    expect(sev).toHaveTextContent("low: 1");
  });

  it("shows the empty state with no RAID entries", () => {
    renderWithProviders(<RaidRegister projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("raid-register-empty")).toBeInTheDocument();
  });

  it("renders an error alert with a working retry when the RAID fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    renderWithProviders(<RaidRegister projectId="p1" />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    // Retry re-invokes the query's fetch (onRetry → refetch()).
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});

afterEach(() => resetFetchMock());
