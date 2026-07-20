import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  invoicesKey,
  invoiceKey,
  useInvoices,
  useInvoice,
  useCreateInvoice,
  useUpdateInvoice,
  useSetInvoiceStatus,
  useDeleteInvoice,
  invoiceActions,
  invoiceStatusTone,
  invoiceLineAmount,
  formatMoney,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  type InvoiceMeta,
  type Invoice,
  type InvoiceInput,
} from "./invoices";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function stubFetch(body: unknown, status = 200) {
  // A 204 must carry a null body (the Response constructor rejects a body otherwise).
  const payload = status === 204 ? null : JSON.stringify(body);
  const fn = vi.fn(async () => new Response(payload, { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const meta = (over: Partial<InvoiceMeta> = {}): InvoiceMeta => ({
  id: "org~i~1", number: "INV-001", clientName: "Acme", currency: "USD", status: "draft",
  total: 1200, lineCount: 2, dueAt: null, updatedAt: "2026-01-01T00:00:00Z", ...over,
});

const fullInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  ...meta(), lines: [], subtotal: 1000, taxRatePct: 20, taxAmount: 200, note: null,
  issuedAt: null, paidAt: null, ownerSub: null, version: 1, createdAt: "", updatedBy: null, ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("query keys", () => {
  it("scopes the list key by project and falls back to 'all'", () => {
    expect(invoicesKey()).toEqual(["invoices", "all"]);
    expect(invoicesKey("p1")).toEqual(["invoices", "p1"]);
    expect(invoiceKey("x")).toEqual(["invoice", "x"]);
  });
});

describe("useInvoices", () => {
  it("fetches the org-wide list with no query string", async () => {
    const fn = stubFetch([meta()]);
    const { result } = renderHook(() => useInvoices(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toHaveLength(1);
    expect(String(fn.mock.calls[0]![0])).toBe("/api/invoices");
  });

  it("appends an encoded projectId query string when scoped", async () => {
    const fn = stubFetch([]);
    const { result } = renderHook(() => useInvoices("p 1"), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fn.mock.calls[0]![0])).toBe("/api/invoices?projectId=p%201");
  });
});

describe("useInvoice", () => {
  it("fetches one invoice by encoded id", async () => {
    const fn = stubFetch(fullInvoice());
    const { result } = renderHook(() => useInvoice("a/b"), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(String(fn.mock.calls[0]![0])).toBe("/api/invoices/a%2Fb");
  });

  it("stays disabled (no fetch) when id is undefined", async () => {
    const fn = stubFetch(fullInvoice());
    const { result } = renderHook(() => useInvoice(undefined), { wrapper: wrapper(client()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("useCreateInvoice", () => {
  const input: InvoiceInput = { number: "INV-9", clientName: "C", currency: "USD", lines: [] };

  it("POSTs and invalidates both the list and the created invoice on success", async () => {
    const fn = stubFetch(fullInvoice({ id: "new-1" }));
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateInvoice(), { wrapper: wrapper(qc) });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/invoices");
    expect((opts as RequestInit).method).toBe("POST");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: invoiceKey("new-1") });
  });

  it("surfaces a server error", async () => {
    stubFetch({ error: "denied" }, 403);
    const { result } = renderHook(() => useCreateInvoice(), { wrapper: wrapper(client()) });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("denied");
  });
});

describe("useUpdateInvoice", () => {
  it("PUTs to the encoded id and invalidates on success", async () => {
    const fn = stubFetch(fullInvoice({ id: "u1" }));
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: wrapper(qc) });
    result.current.mutate({ id: "u1", input: { number: "N", clientName: "C", currency: "USD", lines: [] } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/invoices/u1");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: invoiceKey("u1") });
  });
});

describe("useSetInvoiceStatus", () => {
  it("POSTs to the status endpoint and invalidates on success", async () => {
    const fn = stubFetch(fullInvoice({ id: "s1", status: "issued" }));
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetInvoiceStatus(), { wrapper: wrapper(qc) });
    result.current.mutate({ id: "s1", status: "issued" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/invoices/s1/status");
    expect((opts as RequestInit).method).toBe("POST");
    expect(String((opts as RequestInit).body)).toContain("issued");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: invoiceKey("s1") });
  });
});

describe("useDeleteInvoice", () => {
  it("DELETEs and invalidates only the list (no invoice key) on success", async () => {
    const fn = stubFetch({}, 204);
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteInvoice(), { wrapper: wrapper(qc) });
    result.current.mutate("d1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/invoices/d1");
    expect((opts as RequestInit).method).toBe("DELETE");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: invoiceKey("d1") });
  });
});

describe("invoiceActions", () => {
  it("returns the allowed transitions per status", () => {
    expect(invoiceActions("draft")).toEqual(["issued", "void"]);
    expect(invoiceActions("issued")).toEqual(["paid", "void"]);
    expect(invoiceActions("paid")).toEqual([]);
    expect(invoiceActions("void")).toEqual([]);
  });
});

describe("invoiceStatusTone", () => {
  it("maps every status to a distinct tone class", () => {
    expect(invoiceStatusTone("paid")).toContain("green");
    expect(invoiceStatusTone("issued")).toContain("blue");
    expect(invoiceStatusTone("void")).toContain("line-through");
    expect(invoiceStatusTone("draft")).toContain("amber");
  });
});

describe("re-exported pure helpers", () => {
  it("re-exports the catalogue constants", () => {
    expect(INVOICE_LINE_KINDS).toContain("labour");
    expect(INVOICE_STATUSES).toContain("draft");
  });

  it("derives line amounts, forcing discounts negative", () => {
    expect(invoiceLineAmount("labour", 2, 50)).toBe(100);
    expect(invoiceLineAmount("discount", 1, 30)).toBe(-30);
  });

  it("formats money with a currency prefix", () => {
    expect(formatMoney(1200, "USD")).toBe("USD 1,200.00");
  });
});
