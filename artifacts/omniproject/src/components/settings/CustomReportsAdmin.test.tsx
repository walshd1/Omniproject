import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("exports a report definition as a JSON download", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    renderWithProviders(<CustomReportsAdmin />, {
      client: seed("pmo", [{ id: "spend", label: "Spend", scope: "portfolio", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "bar" }]),
    });
    fireEvent.click(screen.getByLabelText("Export report 1"));
    expect(click).toHaveBeenCalled();
  });

  it("imports a report definition file, appending it with a collision-safe id", async () => {
    renderWithProviders(<CustomReportsAdmin />, {
      client: seed("pmo", [{ id: "spend", label: "Spend", scope: "portfolio", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "bar" }]),
    });
    const incoming = { id: "spend", label: "Imported spend", scope: "project", viz: "table", metrics: [{ field: "budget", agg: "avg" }] };
    const file = new File([JSON.stringify(incoming)], "spend.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(incoming)) });

    fireEvent.change(screen.getByLabelText("Import report definition"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText("Report 2 label")).toHaveValue("Imported spend"));
    // original id kept, imported one de-duped to spend-2
    expect(screen.getByTestId("custom-report-edit-1")).toBeInTheDocument();
  });

  it("lists the built-in report files and exports one as a JSON definition", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    expect(screen.getByTestId("builtin-report-files")).toBeInTheDocument();
    // A known catalogue report renders with its renderer and is exportable.
    const evmRow = screen.getByTestId("builtin-report-evm");
    expect(evmRow).toHaveTextContent("FinancialEvmChart");
    fireEvent.click(within(evmRow).getByRole("button", { name: /Export/ }));
    expect(click).toHaveBeenCalled();
  });

  it("rejects a non-report JSON file with a friendly error", async () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    const file = new File(['{"hello":"world"}'], "nope.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve('{"hello":"world"}') });
    fireEvent.change(screen.getByLabelText("Import report definition"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/label/);
  });
});
