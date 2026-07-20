import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { invoicesKey, type InvoiceMeta } from "../lib/invoices";
import { Invoices } from "./Invoices";

/** The Invoices page: list rendering, empty state, and the create-form toggle. Data-layer hooks are covered
 *  by the server route tests. */
function seed(invoices: InvoiceMeta[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(invoicesKey(), invoices);
  return qc;
}
const meta = (over: Partial<InvoiceMeta> = {}): InvoiceMeta => ({
  id: "org~i~1", number: "INV-001", clientName: "Acme", currency: "USD", status: "draft",
  total: 1200, lineCount: 2, dueAt: null, updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("Invoices page", () => {
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

  it("toggles the create form and previews the derived subtotal", () => {
    renderWithProviders(<Invoices />, { client: seed([]) });
    expect(screen.queryByTestId("invoice-create-form")).toBeNull();
    fireEvent.click(screen.getByTestId("invoice-new"));
    expect(screen.getByTestId("invoice-create-form")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-subtotal-preview")).toBeInTheDocument();
  });
});
