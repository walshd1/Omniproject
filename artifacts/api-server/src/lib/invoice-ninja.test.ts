import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice, InvoiceLine } from "./invoice";
import {
  invoiceNinjaSyncEnabled, toNinjaInvoice, toNinjaLine, ninjaCorrelation, parseNinjaCorrelation,
  parseNinjaResult, parseNinjaWebhook, invoiceNinjaWebhookSecret, ninjaSystemContext,
  parseNinjaStatus, pullInvoice,
} from "./invoice-ninja";
import { applyInvoiceExternalRef, newInvoiceRow, invoiceMeta, type InvoiceExternalRef } from "./invoice";

/** Phase-1 Invoice Ninja bridge — pure mapping + config gate + correlation (docs/design/INVOICE-NINJA.md). */

function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return { id: "l1", kind: "labour", description: "Design work", quantity: 10, unitPrice: 100, amount: 1000, ...over };
}
function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_abc", number: "INV-001", clientName: "Acme Ltd", projectId: "p1", currency: "USD",
    status: "issued", lines: [line()], subtotal: 1000, taxRatePct: 20, taxAmount: 200, total: 1200,
    note: "Thanks", dueAt: "2026-08-01T00:00:00.000Z", issuedAt: "2026-07-25T00:00:00.000Z", paidAt: null,
    ownerSub: "u1", storage: {} as Invoice["storage"], version: 1,
    createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z", updatedBy: "u1", ...over,
  };
}

test("invoiceNinjaSyncEnabled honours the deploy flag", () => {
  assert.equal(invoiceNinjaSyncEnabled({ INVOICE_NINJA_SYNC: "1" }), true);
  assert.equal(invoiceNinjaSyncEnabled({ INVOICE_NINJA_SYNC: "true" }), true);
  assert.equal(invoiceNinjaSyncEnabled({ INVOICE_NINJA_SYNC: "on" }), true);
  assert.equal(invoiceNinjaSyncEnabled({ INVOICE_NINJA_SYNC: "0" }), false);
  assert.equal(invoiceNinjaSyncEnabled({}), false);
});

test("correlation round-trips and rejects foreign values", () => {
  assert.equal(ninjaCorrelation("inv_abc"), "omni:inv_abc");
  assert.equal(parseNinjaCorrelation("omni:inv_abc"), "inv_abc");
  assert.equal(parseNinjaCorrelation("something-else"), null);
  assert.equal(parseNinjaCorrelation("omni:"), null);
  assert.equal(parseNinjaCorrelation(42), null);
});

test("toNinjaLine maps kind→type_id and signs discounts negative", () => {
  assert.deepEqual(toNinjaLine(line({ kind: "labour" })), { type_id: "2", product_key: "labour", notes: "Design work", cost: 100, quantity: 10 });
  assert.equal(toNinjaLine(line({ kind: "expense" })).type_id, "1");
  assert.equal(toNinjaLine(line({ kind: "fixed" })).type_id, "1");
  // Discount: cost forced negative so cost × quantity reduces the total, matching the catalogue's signed amount.
  assert.equal(toNinjaLine(line({ kind: "discount", unitPrice: 50 })).cost, -50);
});

test("toNinjaInvoice produces a faithful Invoice Ninja payload without local totals", () => {
  const n = toNinjaInvoice(invoice());
  assert.equal(n.number, "INV-001");
  assert.equal(n.client_name, "Acme Ltd");
  assert.equal(n.currency_code, "USD");
  assert.equal(n.tax_rate1, 20);
  assert.equal(n.tax_name1, "Tax");
  assert.equal(n.due_date, "2026-08-01"); // date-only
  assert.equal(n.custom_value1, "omni:inv_abc");
  assert.equal(n.line_items.length, 1);
  // Local subtotal/total are intentionally NOT sent — Invoice Ninja recomputes from lines + tax.
  assert.equal("subtotal" in n, false);
  assert.equal("total" in n, false);
});

test("no tax → empty tax name, zero rate; null due date passes through", () => {
  const n = toNinjaInvoice(invoice({ taxRatePct: 0, dueAt: null }));
  assert.equal(n.tax_name1, "");
  assert.equal(n.tax_rate1, 0);
  assert.equal(n.due_date, null);
});

// ── Phase 2: push response parsing + external-ref recording ──
const NOW = "2026-07-25T02:00:00.000Z";

test("parseNinjaResult reads the wrapped {data} record, number, and portal link", () => {
  const ref = parseNinjaResult({ data: { id: "IN-9", number: "0001", invitations: [{ link: "https://in.example/x" }] } }, NOW);
  assert.deepEqual(ref, { system: "invoice-ninja", id: "IN-9", number: "0001", pdfUrl: "https://in.example/x", pushedAt: NOW });
});

test("parseNinjaResult tolerates a bare record and a numeric id, and defaults optional fields", () => {
  const ref = parseNinjaResult({ id: 42 }, NOW);
  assert.deepEqual(ref, { system: "invoice-ninja", id: "42", number: null, pdfUrl: null, pushedAt: NOW });
});

test("parseNinjaResult returns null when there is no usable id", () => {
  assert.equal(parseNinjaResult({ data: {} }, NOW), null);
  assert.equal(parseNinjaResult(null, NOW), null);
  assert.equal(parseNinjaResult("nope", NOW), null);
});

test("a new invoice row starts unsynced; applyInvoiceExternalRef records the ref and surfaces in meta", () => {
  const ctx = { sub: "u1" } as Parameters<typeof newInvoiceRow>[2];
  const row = newInvoiceRow("inv_abc", { number: "INV-1", clientName: "Acme", currency: "USD", taxRatePct: 0, note: null, dueAt: null, lines: [], storage: {} as never, projectId: null } as unknown as Parameters<typeof newInvoiceRow>[1], ctx, NOW);
  assert.equal(row.externalRef, null);
  assert.equal(invoiceMeta(row).externalRef, undefined); // no ref → omitted from the list projection

  const ref: InvoiceExternalRef = { system: "invoice-ninja", id: "IN-9", number: "0001", pdfUrl: null, pushedAt: NOW };
  const synced = applyInvoiceExternalRef(row, ref, ctx, "2026-07-25T03:00:00.000Z");
  assert.deepEqual(synced.externalRef, ref);
  assert.equal(synced.version, row.version + 1);
  assert.deepEqual(invoiceMeta(synced).externalRef, ref);
});

// ── Phase 4: inbound payment webhook ─────────────────────────────────────────────────────────────────

test("parseNinjaWebhook pulls the omni id from custom_value1 at the top level", () => {
  assert.deepEqual(parseNinjaWebhook({ custom_value1: ninjaCorrelation("proj~p1~inv9"), status_id: "4" }), { invoiceId: "proj~p1~inv9" });
});

test("parseNinjaWebhook tolerates data/invoice/payload wrappers and an invoices[] array", () => {
  assert.deepEqual(parseNinjaWebhook({ data: { custom_value1: "omni:org~inv1" } }), { invoiceId: "org~inv1" });
  assert.deepEqual(parseNinjaWebhook({ invoice: { custom_value1: "omni:org~inv2" } }), { invoiceId: "org~inv2" });
  assert.deepEqual(parseNinjaWebhook({ payload: { custom_value1: "omni:org~inv3" } }), { invoiceId: "org~inv3" });
  // A payment event references its invoices — correlation sits on the first invoice.
  assert.deepEqual(parseNinjaWebhook({ event_type: "payment", invoices: [{ id: "IN-1", custom_value1: "omni:org~inv4" }] }), { invoiceId: "org~inv4" });
  assert.deepEqual(parseNinjaWebhook({ data: { invoices: [{ custom_value1: "omni:org~inv5" }] } }), { invoiceId: "org~inv5" });
});

test("parseNinjaWebhook accepts an explicit `correlation` field too", () => {
  assert.deepEqual(parseNinjaWebhook({ correlation: "omni:org~inv6" }), { invoiceId: "org~inv6" });
});

test("parseNinjaWebhook returns null when no omni correlation is present", () => {
  assert.equal(parseNinjaWebhook({ custom_value1: "someone-elses-ref" }), null);
  assert.equal(parseNinjaWebhook({ status_id: "4" }), null);
  assert.equal(parseNinjaWebhook(null), null);
  assert.equal(parseNinjaWebhook("nope"), null);
  assert.equal(parseNinjaWebhook({ invoices: [] }), null);
});

test("invoiceNinjaWebhookSecret trims and treats blank as unset", () => {
  assert.equal(invoiceNinjaWebhookSecret({ INVOICE_NINJA_WEBHOOK_SECRET: "  s3cret  " } as NodeJS.ProcessEnv), "s3cret");
  assert.equal(invoiceNinjaWebhookSecret({ INVOICE_NINJA_WEBHOOK_SECRET: "   " } as NodeJS.ProcessEnv), undefined);
  assert.equal(invoiceNinjaWebhookSecret({} as NodeJS.ProcessEnv), undefined);
});

test("ninjaSystemContext is a sub-less automation actor (invoices are org/project scoped)", () => {
  const ctx = ninjaSystemContext();
  assert.equal(ctx.actorKind, "automation");
  assert.equal(ctx.sub, "system:invoice-ninja");
  assert.ok(ctx.name && ctx.name.length > 0);
});

// ── Phase 5: pull-back (get_invoice → refresh + reconcile paid) ───────────────────────────────────────

test("parseNinjaStatus reads the paid signal from status_id (4) and a zeroed balance", () => {
  assert.equal(parseNinjaStatus({ status_id: 4 }), "paid");
  assert.equal(parseNinjaStatus({ status_id: "4" }), "paid"); // string form
  assert.equal(parseNinjaStatus({ data: { status_id: 4 } }), "paid"); // {data} wrapper
  assert.equal(parseNinjaStatus({ balance: 0, paid_to_date: 1200 }), "paid"); // settled by balance
  assert.equal(parseNinjaStatus({ balance: -0.0, paid_to_date: 5 }), "paid");
});

test("parseNinjaStatus returns null for any non-paid / unknown record", () => {
  assert.equal(parseNinjaStatus({ status_id: 2 }), null); // sent, not paid
  assert.equal(parseNinjaStatus({ balance: 100, paid_to_date: 0 }), null); // outstanding
  assert.equal(parseNinjaStatus({ balance: 0, paid_to_date: 0 }), null); // zero invoice, nothing paid
  assert.equal(parseNinjaStatus({}), null);
  assert.equal(parseNinjaStatus(null), null);
  assert.equal(parseNinjaStatus("nope"), null);
});

test("pullInvoice short-circuits (no broker call) when the invoice was never pushed", async () => {
  const notPushed = invoice({ externalRef: null });
  assert.deepEqual(await pullInvoice({ sub: "u1" } as Parameters<typeof pullInvoice>[0], notPushed, NOW), { ref: null, paid: false });
});
