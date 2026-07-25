import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice, InvoiceLine } from "./invoice";
import {
  invoiceNinjaSyncEnabled, toNinjaInvoice, toNinjaLine, ninjaCorrelation, parseNinjaCorrelation,
} from "./invoice-ninja";

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
