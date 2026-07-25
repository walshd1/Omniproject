import type { ActorContext } from "../broker/types";
import { brokerCommand } from "../broker";
import type { Invoice, InvoiceLine } from "./invoice";

/**
 * Invoice Ninja bridge — phase 1 (docs/design/INVOICE-NINJA.md).
 *
 * OmniProject already OWNS invoicing (lib/invoice.ts: a sealed, zero-at-rest invoice with a draft→issued→paid
 * state machine). Invoice Ninja is an external BILLING SYSTEM OF RECORD; this bridge SYNCS the local invoice
 * to it and reads status back — it does not reinvent invoicing.
 *
 * Invoice Ninja is just another BACKEND: it's registered in the backend catalogue
 * (`vendors/backends/invoice-ninja.json`, `financials` capability) implementing the invoice contract verbs
 * (`create_invoice`/`update_invoice`/`get_invoice`/`list_invoices`), so its n8n workflow is GENERATED like any
 * other backend and the Invoice Ninja `X-API-Token` lives in the broker's secret store — the gateway stays
 * zero-at-rest, never holding the vendor credential. This module shapes the vendor payload
 * (`toNinjaInvoice`) and dispatches the verb through the broker; the broker routes it to the backend.
 */

/** Audit/source tag carried on every bridged command (matches the local `invoicing` feature domain). */
export const NINJA_SOURCE = "invoicing";

/** The invoice contract verbs Invoice Ninja implements as a backend (a subset of ContractAction). */
export type NinjaOp = "create_invoice" | "update_invoice" | "get_invoice" | "list_invoices";

/** The bridge is opt-in: it needs both the `invoicing` feature (checked at the route) AND this deploy flag,
 *  since it emits outbound commands the operator must have wired an n8n workflow for. */
export function invoiceNinjaSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env["INVOICE_NINJA_SYNC"] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

// ── Invoice Ninja v5 payload shapes (the subset this bridge writes) ─────────────────────────────────────
export interface NinjaLineItem {
  /** Invoice Ninja line type: "1" = product/fixed, "2" = task/labour. */
  type_id: "1" | "2";
  /** Human key shown on the line (we use the OmniProject line kind). */
  product_key: string;
  /** Line description. */
  notes: string;
  /** UNIT price, signed so a discount reduces the total (Invoice Ninja multiplies cost × quantity). */
  cost: number;
  quantity: number;
}

export interface NinjaInvoicePayload {
  number: string;
  /** Client display name; client_id resolution (create-or-match) is the n8n workflow's / phase-5 job. */
  client_name: string;
  currency_code: string;
  line_items: NinjaLineItem[];
  tax_name1: string;
  tax_rate1: number;
  /** ISO date (YYYY-MM-DD) or null. */
  due_date: string | null;
  public_notes: string | null;
  /** Correlation key so the inbound payment webhook can map back to the local invoice (Invoice Ninja custom
   *  field). Prefixed to make provenance unambiguous in the external system. */
  custom_value1: string;
}

const NINJA_CORRELATION_PREFIX = "omni:";

/** The correlation value stored on the Invoice Ninja invoice (and matched on the inbound webhook). */
export function ninjaCorrelation(invoiceId: string): string {
  return `${NINJA_CORRELATION_PREFIX}${invoiceId}`;
}

/** Parse the OmniProject invoice id back out of a correlation value, or null if it isn't one of ours. */
export function parseNinjaCorrelation(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(NINJA_CORRELATION_PREFIX)) return null;
  const id = value.slice(NINJA_CORRELATION_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** ISO date-time → date-only (YYYY-MM-DD), or null. Invoice Ninja due_date is a plain date. */
function dateOnly(ts: string | null): string | null {
  if (!ts) return null;
  const d = ts.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Map one OmniProject line to an Invoice Ninja line item. `cost` carries the discount sign so cost × qty
 *  reproduces the local line amount (discounts are forced negative in the catalogue). Pure. */
export function toNinjaLine(line: InvoiceLine): NinjaLineItem {
  const cost = line.kind === "discount" ? -Math.abs(line.unitPrice) : line.unitPrice;
  return {
    type_id: line.kind === "labour" ? "2" : "1",
    product_key: line.kind,
    notes: line.description,
    cost,
    quantity: line.quantity,
  };
}

/**
 * Map a local {@link Invoice} to the Invoice Ninja invoice payload. Pure and total — no I/O — so the mapping
 * is unit-testable without a broker. Amounts/totals are NOT sent (Invoice Ninja recomputes from lines + tax),
 * which is the correct posture: the external system owns its own arithmetic once the lines + tax rate cross.
 */
export function toNinjaInvoice(inv: Invoice): NinjaInvoicePayload {
  return {
    number: inv.number,
    client_name: inv.clientName,
    currency_code: inv.currency,
    line_items: inv.lines.map(toNinjaLine),
    tax_name1: inv.taxRatePct > 0 ? "Tax" : "",
    tax_rate1: inv.taxRatePct,
    due_date: dateOnly(inv.dueAt),
    public_notes: inv.note,
    custom_value1: ninjaCorrelation(inv.id),
  };
}

/** Dispatch an invoice contract verb through the broker to the Invoice Ninja backend. The broker routes the
 *  action to the generated Invoice Ninja workflow; the vendor token lives in the broker, never here. */
export function ninjaCommand(ctx: ActorContext, op: NinjaOp, payload: Record<string, unknown>): Promise<unknown> {
  return brokerCommand(ctx, op, payload, NINJA_SOURCE);
}
