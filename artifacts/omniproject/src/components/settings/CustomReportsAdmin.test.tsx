import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { customReportsQueryKey } from "../../lib/custom-reports-api";
import { reportOverridesQueryKey } from "../../lib/report-overrides";
import { availabilityQueryKey, type Availability } from "../../lib/availability";
import type { CustomReportDef } from "../../lib/custom-report";
import { CustomReportsAdmin } from "./CustomReportsAdmin";

const AVAIL: Availability = { source: "manifest", fields: ["status", "budget"], available: ["status", "budget"], hidden: [], tables: [], relationships: [] };

function seed(role: string | undefined, reports: CustomReportDef[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(customReportsQueryKey, reports);
  qc.setQueryData(reportOverridesQueryKey, []);
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

  it("a tasks-scoped report sources its fields from the task descriptor and saves", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ report"));
    fireEvent.change(screen.getByLabelText("Report 1 label"), { target: { value: "Tasks by context" } });
    fireEvent.change(screen.getByLabelText("Report 1 scope"), { target: { value: "tasks" } });
    // The group-by options now come from the task field catalog (e.g. "context"), not the issue superset.
    const groupBy = screen.getByLabelText("Report 1 group by") as HTMLSelectElement;
    const opts = within(groupBy).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(opts).toContain("context");
    expect(opts).not.toContain("budget");
    fireEvent.change(groupBy, { target: { value: "context" } });
    fireEvent.click(screen.getByText("Save reports"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse(init.body as string);
    expect(body.customReports[0]).toMatchObject({ label: "Tasks by context", scope: "tasks", groupBy: "context" });
  });

  it("saves chart type + options (pie / stacked / legend) from the chart editor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ report"));
    fireEvent.change(screen.getByLabelText("Report 1 label"), { target: { value: "Spend share" } });
    fireEvent.change(screen.getByLabelText("Report 1 viz"), { target: { value: "bar" } });
    // Chart options appear for a chart viz: turn the legend off and stack the series.
    fireEvent.click(screen.getByLabelText("Report 1 show legend"));
    fireEvent.click(screen.getByLabelText("Report 1 stacked"));
    fireEvent.click(screen.getByText("Save reports"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse(init.body as string);
    expect(body.customReports[0]).toMatchObject({ viz: "bar", chart: { legend: false, stacked: true } });
  });

  it("shows the second group-by select only once a first group-by is chosen, and saves the pivot", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ report"));
    expect(screen.queryByLabelText("Report 1 group by 2")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Report 1 group by"), { target: { value: "status" } });
    expect(screen.getByLabelText("Report 1 group by 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Report 1 group by 2"), { target: { value: "budget" } });

    fireEvent.click(screen.getByText("Save reports"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse(init.body as string);
    expect(body.customReports[0]).toMatchObject({ groupBy: "status", groupBy2: "budget" });
  });

  it("clears the second group-by when the first is cleared", () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    fireEvent.click(screen.getByText("+ report"));
    fireEvent.change(screen.getByLabelText("Report 1 group by"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("Report 1 group by 2"), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText("Report 1 group by"), { target: { value: "" } });
    expect(screen.queryByLabelText("Report 1 group by 2")).not.toBeInTheDocument();
  });

  it("swaps the group-by controls for a date-field selector when viz is line, and saves it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ report"));
    fireEvent.change(screen.getByLabelText("Report 1 viz"), { target: { value: "line" } });
    expect(screen.queryByLabelText("Report 1 group by")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Report 1 date field"), { target: { value: "budget" } });

    fireEvent.click(screen.getByText("Save reports"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse(init.body as string);
    expect(body.customReports[0]).toMatchObject({ viz: "line", dateField: "budget" });
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

  it("edits a built-in report's metadata and saves it as an override", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reportOverrides: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    fireEvent.change(within(screen.getByTestId("builtin-report-evm")).getByLabelText("evm label"), { target: { value: "Earned value (renamed)" } });
    fireEvent.click(screen.getByText("Save overrides"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/overrides")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/overrides")!;
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reportOverrides).toContainEqual(expect.objectContaining({ id: "evm", label: "Earned value (renamed)" }));
  });

  it("rejects a non-report JSON file with a friendly error", async () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    const file = new File(['{"hello":"world"}'], "nope.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve('{"hello":"world"}') });
    fireEvent.change(screen.getByLabelText("Import report definition"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/label/);
  });

  it("shows the empty-state prompt when there are no bespoke reports", () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    expect(screen.getByTestId("custom-reports-empty")).toBeInTheDocument();
  });

  it("edits a metric's aggregate and field, and enables the field only for non-count aggs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    fireEvent.click(screen.getByText("+ report"));

    // A fresh report's single metric defaults to count → its field picker is disabled.
    expect(screen.getByLabelText("Report 1 metric 1 field")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Report 1 metric 1 agg"), { target: { value: "sum" } });
    expect(screen.getByLabelText("Report 1 metric 1 field")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Report 1 metric 1 field"), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText("Report 1 metric 1 label"), { target: { value: "Total spend" } });
    fireEvent.click(screen.getByText("Save reports"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.customReports[0].metrics[0]).toMatchObject({ agg: "sum", field: "budget", label: "Total spend" });
  });

  it("adds and removes metrics, keeping at least one", () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    fireEvent.click(screen.getByText("+ report"));
    fireEvent.click(screen.getByText("+ metric"));
    expect(screen.getByTestId("custom-report-0-metric-1")).toBeInTheDocument();
    // Remove the second one — back to a single metric.
    fireEvent.click(screen.getByLabelText("Remove metric 2 from report 1"));
    expect(screen.queryByTestId("custom-report-0-metric-1")).not.toBeInTheDocument();
    // Removing the last remaining metric is a no-op (a report needs one).
    fireEvent.click(screen.getByLabelText("Remove metric 1 from report 1"));
    expect(screen.getByTestId("custom-report-0-metric-0")).toBeInTheDocument();
  });

  it("removes a report, returning to the empty state", () => {
    renderWithProviders(<CustomReportsAdmin />, {
      client: seed("pmo", [{ id: "r1", label: "One", scope: "project", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "table" }]),
    });
    expect(screen.getByTestId("custom-report-edit-0")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.queryByTestId("custom-report-edit-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("custom-reports-empty")).toBeInTheDocument();
  });

  it("resets unsaved edits back to the server definition", () => {
    renderWithProviders(<CustomReportsAdmin />, {
      client: seed("pmo", [{ id: "r1", label: "Original", scope: "project", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "table" }]),
    });
    fireEvent.change(screen.getByLabelText("Report 1 label"), { target: { value: "Edited" } });
    expect(screen.getByLabelText("Report 1 label")).toHaveValue("Edited");
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByLabelText("Report 1 label")).toHaveValue("Original");
  });

  it("exports every bespoke report at once", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    renderWithProviders(<CustomReportsAdmin />, {
      client: seed("pmo", [{ id: "r1", label: "One", scope: "project", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "table" }]),
    });
    fireEvent.click(screen.getByText("Export all"));
    expect(click).toHaveBeenCalled();
  });

  it("surfaces the save error message when saving reports fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }), text: async () => "boom" } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    fireEvent.click(screen.getByText("+ report"));
    fireEvent.click(screen.getByText("Save reports"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("adds a filter predicate to a report and saves it under the filter.all set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ customReports: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    fireEvent.click(screen.getByText("+ report"));
    // The report's PredicateEditor exposes a "+ condition" control; adding one fires its onChange.
    fireEvent.click(screen.getByRole("button", { name: /\+ condition/i }));
    fireEvent.click(screen.getByText("Save reports"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/custom")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/custom")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.customReports[0].filter.all.length).toBeGreaterThan(0);
  });

  it("hides and reorders a built-in report, saving both as overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reportOverrides: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });

    const row = screen.getByTestId("builtin-report-evm");
    fireEvent.click(within(row).getByLabelText("Hide evm"));
    fireEvent.change(within(row).getByLabelText("evm order"), { target: { value: "42" } });
    fireEvent.click(screen.getByText("Save overrides"));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/reports/overrides")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/reports/overrides")!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reportOverrides).toContainEqual(expect.objectContaining({ id: "evm", hidden: true, order: 42 }));
  });

  it("keeps the Save overrides button disabled until a built-in is edited", () => {
    renderWithProviders(<CustomReportsAdmin />, { client: seed("pmo", []) });
    expect(screen.getByText("Save overrides")).toBeDisabled();
  });
});
