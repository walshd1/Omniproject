import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { invoicesKey, type InvoiceMeta, type Invoice } from "./invoices";
import { Invoices } from "./Invoices";

/** The Invoices page: listing, empty state, the create-draft form (line editing, derived preview, submit +
 *  error), and the invoice detail (lines, totals, status transitions, delete). */
function seed(invoices: InvoiceMeta[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(invoicesKey(), invoices);
  return qc;
}

const meta = (over: Partial<InvoiceMeta> = {}): InvoiceMeta => ({
  id: "org~i~1", number: "INV-001", clientName: "Acme", currency: "USD", status: "draft",
  total: 1200, lineCount: 2, dueAt: null, updatedAt: "2026-01-01T00:00:00Z", ...over,
});

const detail = (over: Partial<Invoice> = {}): Invoice => ({
  ...meta(),
  lines: [{ id: "l1", kind: "labour", description: "Dev work", quantity: 10, unitPrice: 100, amount: 1000 }],
  subtotal: 1000, taxRatePct: 20, taxAmount: 200, note: null,
  issuedAt: null, paidAt: null, ownerSub: null, version: 1, createdAt: "", updatedBy: null, ...over,
});

afterEach(() => resetFetchMock());

describe("Invoices page — listing", () => {
  it("renders a row per invoice with its total and status", () => {
    renderWithProviders(<Invoices />, { client: seed([meta(), meta({ id: "org~i~2", number: "INV-002", status: "paid", total: 500 })]) });
    expect(screen.getByTestId("invoice-row-org~i~1")).toHaveTextContent("INV-001");
    expect(screen.getByTestId("invoice-row-org~i~1")).toHaveTextContent("USD 1,200.00");
    expect(screen.getByTestId("invoice-row-org~i~2")).toHaveTextContent("INV-002");
  });

  it("shows the empty state when there are no invoices", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    expect(screen.getByText(/No invoices yet/i)).toBeInTheDocument();
  });

  it("prompts to select an invoice before any is chosen", () => {
    renderWithProviders(<Invoices />, { client: seed([meta()]) });
    expect(screen.getByText(/Select an invoice to view its lines/i)).toBeInTheDocument();
  });
});

describe("Invoices page — create form", () => {
  it("toggles the create form and previews the derived subtotal", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    expect(screen.queryByTestId("invoice-create-form")).toBeNull();
    fireEvent.click(screen.getByTestId("invoice-new"));
    expect(screen.getByTestId("invoice-create-form")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-subtotal-preview")).toBeInTheDocument();
  });

  it("edits lines and recomputes the preview, including a negative discount", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));

    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
    fireEvent.change(screen.getByLabelText("Tax rate"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Consulting" } });
    fireEvent.change(screen.getByLabelText("Line 1 quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "100" } });

    // Add a second line and make it a discount → its derived amount is negative.
    fireEvent.click(screen.getByText("+ Add line"));
    fireEvent.change(screen.getByLabelText("Line 2 kind"), { target: { value: "discount" } });
    fireEvent.change(screen.getByLabelText("Line 2 description"), { target: { value: "Loyalty" } });
    fireEvent.change(screen.getByLabelText("Line 2 unit price"), { target: { value: "50" } });

    // 3×100 = 300, discount 1×50 forced to -50 → 250, formatted in the upper-cased currency.
    expect(screen.getByTestId("invoice-subtotal-preview")).toHaveTextContent("EUR 250.00");
  });

  it("keeps submit disabled until a number and client are present", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    const submit = screen.getByTestId("invoice-create-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("invoice-number"), { target: { value: "INV-9" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("invoice-client"), { target: { value: "Globex" } });
    expect(submit).not.toBeDisabled();
  });

  it("creates a draft and closes the form on success", async () => {
    const calls = mockFetchRouter({ "POST /api/invoices": { ok: true, body: detail({ id: "org~i~new" }) }, "/api/invoices": { ok: true, body: [meta()] } });
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    fireEvent.change(screen.getByTestId("invoice-number"), { target: { value: "INV-9" } });
    fireEvent.change(screen.getByTestId("invoice-client"), { target: { value: "Globex" } });
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Work" } });
    fireEvent.click(screen.getByTestId("invoice-create-submit"));

    await waitFor(() => expect(screen.queryByTestId("invoice-create-form")).toBeNull());
    const post = calls.find((c) => new URL(c.url, "http://x").pathname === "/api/invoices" && c.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(String(post!.init?.body)).toContain("Globex");
  });

  it("drops blank-description lines and tolerates non-numeric quantities on submit", async () => {
    const calls = mockFetchRouter({ "POST /api/invoices": { ok: true, body: detail() }, "/api/invoices": { ok: true, body: [meta()] } });
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    fireEvent.change(screen.getByTestId("invoice-number"), { target: { value: "INV-9" } });
    fireEvent.change(screen.getByTestId("invoice-client"), { target: { value: "Globex" } });
    // Line 1: kept, but with a non-numeric quantity → falls back to 0.
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Work" } });
    fireEvent.change(screen.getByLabelText("Line 1 quantity"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "abc" } });
    // Line 2: blank description → filtered out of the payload.
    fireEvent.click(screen.getByText("+ Add line"));
    // Blank tax rate → falls back to 0.
    fireEvent.change(screen.getByLabelText("Tax rate"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("invoice-create-submit"));

    await waitFor(() => expect(screen.queryByTestId("invoice-create-form")).toBeNull());
    const post = calls.find((c) => c.init?.method === "POST")!;
    const body = JSON.parse(String(post.init?.body));
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].quantity).toBe(0);
  });

  it("shows an inline error when the create fails", async () => {
    mockFetchRouter({ "POST /api/invoices": { ok: false, status: 403, body: { error: "forbidden" } } });
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    fireEvent.change(screen.getByTestId("invoice-number"), { target: { value: "INV-9" } });
    fireEvent.change(screen.getByTestId("invoice-client"), { target: { value: "Globex" } });
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Work" } });
    fireEvent.click(screen.getByTestId("invoice-create-submit"));
    expect(await screen.findByText(/Couldn't create the invoice/i)).toBeInTheDocument();
  });

  it("closes the form via Cancel", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("invoice-create-form")).toBeNull();
  });
});

describe("Invoices page — detail", () => {
  it("loads the selected invoice with its lines and totals", async () => {
    mockFetchRouter({ "/api/invoices/org~i~1": { ok: true, body: detail() } });
    renderWithProviders(<Invoices />, { client: seed([meta()]) });
    fireEvent.click(screen.getByTestId("invoice-row-org~i~1"));

    expect(await screen.findByTestId("invoice-detail")).toBeInTheDocument();
    expect(screen.getByText("Dev work")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("USD 1,200.00");
    // A draft exposes issue + void transitions.
    expect(screen.getByTestId("invoice-to-issued")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-to-void")).toBeInTheDocument();
  });

  it("offers the Mark paid transition for an issued invoice", async () => {
    mockFetchRouter({ "/api/invoices/org~i~1": { ok: true, body: detail({ status: "issued" }) } });
    renderWithProviders(<Invoices />, { client: seed([meta({ status: "issued" })]) });
    fireEvent.click(screen.getByTestId("invoice-row-org~i~1"));
    expect(await screen.findByTestId("invoice-to-paid")).toHaveTextContent("Mark paid");
    expect(screen.getByTestId("invoice-to-void")).toHaveTextContent("Void");
    expect(screen.queryByTestId("invoice-to-issued")).toBeNull();
  });

  it("falls back to USD in the preview when the currency field is cleared", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    fireEvent.click(screen.getByTestId("invoice-new"));
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "" } });
    expect(screen.getByTestId("invoice-subtotal-preview")).toHaveTextContent("USD");
  });

  it("shows the error surface when the detail fetch fails", async () => {
    mockFetchRouter({ "/api/invoices/org~i~1": { ok: false, status: 500, body: { error: "boom" } } });
    renderWithProviders(<Invoices />, { client: seed([meta()]) });
    fireEvent.click(screen.getByTestId("invoice-row-org~i~1"));
    expect(await screen.findByText(/Could not load/i)).toBeInTheDocument();
  });

  it("transitions status via the action buttons", async () => {
    const calls = mockFetchRouter({
      "/api/invoices/org~i~1": { ok: true, body: detail() },
      "POST /api/invoices/org~i~1/status": { ok: true, body: detail({ status: "issued" }) },
      "/api/invoices": { ok: true, body: [meta()] },
    });
    renderWithProviders(<Invoices />, { client: seed([meta()]) });
    fireEvent.click(screen.getByTestId("invoice-row-org~i~1"));
    fireEvent.click(await screen.findByTestId("invoice-to-issued"));

    await waitFor(() =>
      expect(calls.some((c) => new URL(c.url, "http://x").pathname === "/api/invoices/org~i~1/status" && c.init?.method === "POST")).toBe(true),
    );
    expect(String(calls.find((c) => c.init?.method === "POST")!.init?.body)).toContain("issued");
  });

  it("deletes the invoice via the trash action", async () => {
    const calls = mockFetchRouter({
      "/api/invoices/org~i~1": { ok: true, body: detail() },
      "DELETE /api/invoices/org~i~1": { ok: true, status: 204 },
      "/api/invoices": { ok: true, body: [meta()] },
    });
    renderWithProviders(<Invoices />, { client: seed([meta()]) });
    fireEvent.click(screen.getByTestId("invoice-row-org~i~1"));
    const detailEl = await screen.findByTestId("invoice-detail");
    fireEvent.click(within(detailEl).getByLabelText("Delete invoice"));

    await waitFor(() =>
      expect(calls.some((c) => new URL(c.url, "http://x").pathname === "/api/invoices/org~i~1" && c.init?.method === "DELETE")).toBe(true),
    );
  });
});
