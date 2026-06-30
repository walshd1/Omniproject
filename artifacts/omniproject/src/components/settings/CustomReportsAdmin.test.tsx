import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { customReportsQueryKey } from "../../lib/custom-reports-api";
import { availabilityQueryKey, type Availability } from "../../lib/availability";
import type { CustomReportDef } from "../../lib/custom-report";
import { CustomReportsAdmin } from "./CustomReportsAdmin";

const AVAIL: Availability = { source: "manifest", fields: ["status", "budget"], available: ["status", "budget"], hidden: [], tables: [], relationships: [] };

function seed(role: string | undefined, reports: CustomReportDef[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(customReportsQueryKey, reports);
  qc.setQueryData(availabilityQueryKey, AVAIL);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("CustomReportsAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("manager", []) });
    expect(screen.queryByTestId("custom-reports-admin")).not.toBeInTheDocument();
  });

  it("adds a report and saves the definition", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ report"));
    fireEvent.change(screen.getByLabelText("Report 1 label"), { target: { value: "Spend by status" } });
    fireEvent.change(screen.getByLabelText("Report 1 group by"), { target: { value: "status" } });
    fireEvent.click(screen.getByText("Save reports"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.customReports[0]).toMatchObject({ label: "Spend by status", scope: "project", groupBy: "status", viz: "table" });
    expect(body.customReports[0].metrics[0]).toMatchObject({ agg: "count" });
  });
});
