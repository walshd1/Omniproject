import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectRaidQueryKey, type RaidEntry } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
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
  it("shows the empty state with no RAID entries", () => {
    renderWithProviders(<RaidRegister projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("raid-register-empty")).toBeInTheDocument();
  });
});
