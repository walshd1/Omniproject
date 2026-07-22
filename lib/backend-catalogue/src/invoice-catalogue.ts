/**
 * INVOICING model — the neutral, primitive-built shape for OmniProject's generated invoices (roadmap 3.3).
 * Same architectural principle as goals (key-result primitives on a goal) and proofs (annotation primitives
 * on a proof): an INVOICE is a JSON definition carrying a list of typed LINE PRIMITIVES, each a priced class
 * (labour / expense / fixed fee / discount). NOT a bespoke record.
 *
 * The single `INVOICE_LINE_KINDS` list is what the authoring palette, the validator AND the unified primitive
 * store (the `invoiceLine` family, placeable on the `invoice` surface) all draw from, so the store can never
 * drift from what an invoice can contain. The authoritative sanitiser + totalling run server-side.
 */
import { numLoose, round2 } from "./num";

/**
 * The kinds of invoice line. `labour` — billable hours × a rate; `expense` — a pass-through cost;
 * `fixed` — a fixed fee / milestone charge; `discount` — a reduction (its amount is always ≤ 0).
 */
export type InvoiceLineKind = "labour" | "expense" | "fixed" | "discount";

/** The invoice-line primitives, as a value — the single list the palette, validator and primitive store
 *  (`invoiceLine` family) all draw from, so the family can't drift from the InvoiceLineKind union. */
export const INVOICE_LINE_KINDS: readonly InvoiceLineKind[] = ["labour", "expense", "fixed", "discount"];

/**
 * An invoice's lifecycle status. `draft` — being prepared; `issued` — sent to the client; `paid` — settled;
 * `void` — cancelled. Only forward-ish transitions are allowed (see the server state helper).
 */
export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["draft", "issued", "paid", "void"];

/**
 * The signed amount of a line by its kind: `quantity × unitPrice`, forced ≤ 0 for a `discount` (so a
 * discount always reduces the total regardless of how its inputs were entered). Pure.
 */
export function invoiceLineAmount(kind: InvoiceLineKind, quantity: number, unitPrice: number): number {
  const raw = round2(numLoose(quantity) * numLoose(unitPrice));
  return kind === "discount" ? -Math.abs(raw) : raw;
}

/** Format a money amount with an ISO-4217 currency code as a prefix (e.g. "USD 1,000.00"). Pure. */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${round2(numLoose(amount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
