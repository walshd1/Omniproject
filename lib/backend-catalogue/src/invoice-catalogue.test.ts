import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOICE_LINE_KINDS, INVOICE_STATUSES, invoiceLineAmount, formatMoney } from "./invoice-catalogue";
import { round2 } from "./num";

/** The invoice line/status primitive catalogue — the source of truth for the `invoiceLine` family. */

test("the closed sets the primitive family + status flow draw from", () => {
  assert.deepEqual([...INVOICE_LINE_KINDS], ["labour", "expense", "fixed", "discount"]);
  assert.deepEqual([...INVOICE_STATUSES], ["draft", "issued", "paid", "void"]);
});

test("invoiceLineAmount = qty × price, and a discount is always ≤ 0", () => {
  assert.equal(invoiceLineAmount("labour", 10, 150), 1500);
  assert.equal(invoiceLineAmount("expense", 1, 42.5), 42.5);
  assert.equal(invoiceLineAmount("discount", 1, 100), -100); // positive input → negative amount
  assert.equal(invoiceLineAmount("discount", 1, -100), -100); // negative input → still negative
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("formatMoney prefixes the currency and fixes 2dp", () => {
  assert.equal(formatMoney(1000, "USD"), "USD 1,000.00");
  assert.equal(formatMoney(42.5, "GBP"), "GBP 42.50");
});
