import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type InvoiceLineKind, type InvoiceStatus } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "../../lib/api";
import { useFeatures, featureEnabled } from "../../lib/features";

export { INVOICE_LINE_KINDS, INVOICE_STATUSES, invoiceLineAmount, formatMoney, type InvoiceLineKind, type InvoiceStatus } from "@workspace/backend-catalogue";

/**
 * Invoicing client hooks over `/api/invoices/*` (roadmap 3.3). A generated invoice — a number + currency +
 * typed line primitives, with amounts + totals derived server-side. Project/org storage (never personal);
 * manager+ only. Behind the default-off `invoicing` feature module.
 */

export type InvoiceStorage = "project" | "org";
export interface InvoiceLine { id: string; kind: InvoiceLineKind; description: string; quantity: number; unitPrice: number; amount: number }
export interface InvoiceMeta {
  id: string; number: string; clientName: string; currency: string; status: InvoiceStatus;
  total: number; lineCount: number; projectId?: string | null; storage?: InvoiceStorage; dueAt: string | null; updatedAt: string;
}
export interface Invoice extends InvoiceMeta {
  lines: InvoiceLine[]; subtotal: number; taxRatePct: number; taxAmount: number; note: string | null;
  issuedAt: string | null; paidAt: string | null; ownerSub: string | null; version: number; createdAt: string; updatedBy: string | null;
}
export interface InvoiceInput {
  number: string; clientName: string; currency: string; taxRatePct?: number; note?: string; dueAt?: string;
  lines: Array<Pick<InvoiceLine, "kind" | "description" | "quantity" | "unitPrice">>;
  storage?: InvoiceStorage; projectId?: string | null;
}

export const invoicesKey = (projectId?: string) => ["invoices", projectId ?? "all"] as const;
export const invoiceKey = (id: string) => ["invoice", id] as const;

/** The invoices (lines omitted — a listing), optionally scoped to a project. Gated on the (default-off)
 *  `invoicing` module — its router only mounts when the feature is on, so a features-off instance would
 *  otherwise 404-spam the console for invoices it can't have. */
export function useInvoices(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const enabled = featureEnabled(useFeatures().data, "invoicing");
  return useQuery({ queryKey: invoicesKey(projectId), queryFn: () => getJson<InvoiceMeta[]>(`/api/invoices${qs}`), enabled, staleTime: 15_000 });
}

/** One invoice with its lines. */
export function useInvoice(id: string | undefined) {
  const enabled = featureEnabled(useFeatures().data, "invoicing");
  return useQuery({
    queryKey: invoiceKey(id ?? ""),
    queryFn: () => getJson<Invoice>(`/api/invoices/${encodeURIComponent(id!)}`),
    enabled: !!id && enabled,
    staleTime: 10_000,
  });
}

function useInvoiceInvalidation() {
  const qc = useQueryClient();
  return (id?: string) => { void qc.invalidateQueries({ queryKey: ["invoices"] }); if (id) void qc.invalidateQueries({ queryKey: invoiceKey(id) }); };
}

/** Create an invoice (manager+ server-side). */
export function useCreateInvoice() {
  const invalidate = useInvoiceInvalidation();
  return useMutation({ mutationFn: (input: InvoiceInput) => sendJson<Invoice>("/api/invoices", input, "POST"), onSuccess: (i) => invalidate(i.id) });
}

/** Update a draft invoice in place. */
export function useUpdateInvoice() {
  const invalidate = useInvoiceInvalidation();
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: InvoiceInput }) => sendJson<Invoice>(`/api/invoices/${encodeURIComponent(id)}`, input, "PUT"), onSuccess: (i) => invalidate(i.id) });
}

/** Transition an invoice's status (issue / pay / void). */
export function useSetInvoiceStatus() {
  const invalidate = useInvoiceInvalidation();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: InvoiceStatus }) => sendJson<Invoice>(`/api/invoices/${encodeURIComponent(id)}/status`, { status }, "POST"), onSuccess: (i) => invalidate(i.id) });
}

/** Delete an invoice. */
export function useDeleteInvoice() {
  const invalidate = useInvoiceInvalidation();
  return useMutation({ mutationFn: (id: string) => sendJson<void>(`/api/invoices/${encodeURIComponent(id)}`, undefined, "DELETE"), onSuccess: () => invalidate() });
}

/** The status actions available from a given status (mirrors the server's INVOICE_TRANSITIONS). */
export function invoiceActions(status: InvoiceStatus): InvoiceStatus[] {
  return status === "draft" ? ["issued", "void"] : status === "issued" ? ["paid", "void"] : [];
}

/** The tint for a status badge. */
export function invoiceStatusTone(status: InvoiceStatus): string {
  switch (status) {
    case "paid": return "text-green-600 border-green-500/40 bg-green-500/10";
    case "issued": return "text-blue-600 border-blue-500/40 bg-blue-500/10";
    case "void": return "text-muted-foreground border-border line-through";
    default: return "text-amber-600 border-amber-500/40 bg-amber-500/10";
  }
}
