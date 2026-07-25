import type { ActorContext } from "../broker/types";
import { brokerCommand } from "../broker";
import type { Invoice, InvoiceLine, InvoiceExternalRef } from "./invoice";

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

/**
 * Parse an Invoice Ninja create/update response into the external ref we store back on the local invoice.
 * Invoice Ninja v5 wraps the record in `{ data: { id, number, invitations: [{ link }] } }`; we tolerate the
 * bare record too. Returns null when no usable external id is present (a failed/opaque response). Pure.
 */
export function parseNinjaResult(raw: unknown, now: string): InvoiceExternalRef | null {
  const outer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const data = outer && outer["data"] && typeof outer["data"] === "object" ? (outer["data"] as Record<string, unknown>) : outer;
  if (!data) return null;
  const rawId = data["id"];
  const id = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : null;
  if (!id) return null;
  const number = typeof data["number"] === "string" ? data["number"] : null;
  let pdfUrl: string | null = null;
  const invitations = data["invitations"];
  if (Array.isArray(invitations) && invitations[0] && typeof invitations[0] === "object") {
    const link = (invitations[0] as Record<string, unknown>)["link"];
    if (typeof link === "string") pdfUrl = link;
  }
  return { system: "invoice-ninja", id, number, pdfUrl, pushedAt: now };
}

/**
 * Push a local invoice to the Invoice Ninja backend: create it, or UPDATE it in place when it already carries
 * an Invoice Ninja external ref (idempotent re-push). Returns the parsed external ref to record on the local
 * invoice, or null if the backend returned no usable id. Throws only on a broker/transport error (the caller
 * wraps it via withBrokerErrors).
 */
export async function pushInvoice(ctx: ActorContext, invoice: Invoice, now: string): Promise<InvoiceExternalRef | null> {
  const payload = toNinjaInvoice(invoice) as unknown as Record<string, unknown>;
  const existingId = invoice.externalRef?.system === "invoice-ninja" ? invoice.externalRef.id : null;
  const op: NinjaOp = existingId ? "update_invoice" : "create_invoice";
  if (existingId) payload["invoiceId"] = existingId; // the update route keys off this
  const result = await ninjaCommand(ctx, op, payload);
  return parseNinjaResult(result, now);
}

// ── Phase 5: pull-back (get_invoice → refresh number/PDF + reconcile paid) ───────────────────────────────

/**
 * Read the settlement signal out of an Invoice Ninja invoice record: `"paid"` when Invoice Ninja marks it
 * settled (v5 `status_id` 4 = paid), or when the balance has reached zero against a positive paid amount;
 * otherwise null (we only ever reconcile the PAID signal on pull — other statuses aren't force-synced from
 * the external system). Tolerates the `{data}` wrapper like {@link parseNinjaResult}. Pure.
 */
export function parseNinjaStatus(raw: unknown): "paid" | null {
  const outer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const data = outer && outer["data"] && typeof outer["data"] === "object" ? (outer["data"] as Record<string, unknown>) : outer;
  if (!data) return null;
  const statusId = data["status_id"];
  if (statusId === 4 || statusId === "4") return "paid";
  const balance = Number(data["balance"]);
  const paidToDate = Number(data["paid_to_date"]);
  if (Number.isFinite(balance) && balance <= 0 && Number.isFinite(paidToDate) && paidToDate > 0) return "paid";
  return null;
}

/**
 * Pull the current Invoice Ninja record for a pushed invoice (`get_invoice`) and return the refreshed
 * external ref (its assigned number + portal/PDF link) plus whether Invoice Ninja now reports it PAID —
 * so the caller can update the local `externalRef` and reconcile status (a manual fallback for a missed
 * webhook). Returns `{ ref: null, paid: false }` when the invoice hasn't been pushed yet or the backend
 * returns nothing usable. Throws only on a broker/transport error (the caller wraps it).
 */
export async function pullInvoice(ctx: ActorContext, invoice: Invoice, now: string): Promise<{ ref: InvoiceExternalRef | null; paid: boolean }> {
  const externalId = invoice.externalRef?.system === "invoice-ninja" ? invoice.externalRef.id : null;
  if (!externalId) return { ref: null, paid: false };
  const result = await ninjaCommand(ctx, "get_invoice", { invoiceId: externalId });
  return { ref: parseNinjaResult(result, now), paid: parseNinjaStatus(result) === "paid" };
}

// ── Phase 4: inbound payment webhook ─────────────────────────────────────────────────────────────────────

/**
 * The shared secret the inbound Invoice Ninja payment webhook must present (via n8n). Separate from the
 * generic `NOTIFY_INGEST_SECRET` — a different trust boundary — so a leak of one doesn't grant the other.
 * Absent ⇒ the webhook route is disabled (503), even when sync is on.
 */
export function invoiceNinjaWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const s = env["INVOICE_NINJA_WEBHOOK_SECRET"]?.trim();
  return s || undefined;
}

/**
 * The session-less actor context for a webhook-driven state change — invoices are org/project scoped
 * (never personal), so no `sub` is needed to resolve their store; this only labels the audit trail
 * (`updatedBy`) and marks the change as automation-initiated.
 */
export function ninjaSystemContext(): ActorContext {
  return { sub: "system:invoice-ninja", name: "Invoice Ninja (webhook)", role: "manager", actorKind: "automation" };
}

/**
 * Pull the local invoice id out of an inbound Invoice Ninja webhook by its `omni:<id>` correlation
 * (the `custom_value1` we stamped on push). Tolerant of the shapes n8n forwards: the correlation may sit
 * at the top level, under a `data` / `invoice` / `payload` wrapper, or on the first element of an
 * `invoices[]` array (a payment event references its invoices). Returns null when no correlation of ours
 * is present. Pure — the route resolves + transitions the invoice.
 */
export function parseNinjaWebhook(raw: unknown): { invoiceId: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const asRec = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

  const candidates: Array<Record<string, unknown> | null> = [obj, asRec(obj["data"]), asRec(obj["invoice"]), asRec(obj["payload"])];
  for (const wrapper of [obj, asRec(obj["data"]), asRec(obj["payload"])]) {
    const invoices = wrapper?.["invoices"];
    if (Array.isArray(invoices)) for (const inv of invoices) candidates.push(asRec(inv));
  }
  for (const c of candidates) {
    if (!c) continue;
    const id = parseNinjaCorrelation(c["custom_value1"] ?? c["correlation"]);
    if (id) return { invoiceId: id };
  }
  return null;
}
