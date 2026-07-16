import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeInvoiceWrite, computeTotals, makeInvoiceId, parseInvoiceId,
  newInvoiceRow, mergeInvoiceRow, invoiceMeta, InvoiceError, type InvoiceLine,
} from "./invoice";
import type { ActorContext } from "../broker/types";

/** Invoice model: write sanitising, derived line amounts + totals, ids, and the row lifecycle. */

const ctx: ActorContext = { sub: "u1", name: "Ada", email: "ada@x.io" } as ActorContext;
const line = (over: Partial<InvoiceLine>): InvoiceLine => ({ id: "l", kind: "labour", description: "work", quantity: 1, unitPrice: 100, amount: 100, ...over });

test("sanitizeInvoiceWrite requires number/client/currency and derives line amounts + totals", () => {
  const w = sanitizeInvoiceWrite({
    number: "INV-001", clientName: "Acme", currency: "usd", storage: "org", taxRatePct: 10,
    lines: [
      { kind: "labour", description: "Dev", quantity: 10, unitPrice: 150 }, // 1500
      { kind: "discount", description: "Loyalty", quantity: 1, unitPrice: 200 }, // -200
    ],
  });
  assert.equal(w.currency, "USD"); // normalised
  assert.equal(w.lines[0]!.amount, 1500);
  assert.equal(w.lines[1]!.amount, -200); // discount forced negative
  const totals = computeTotals(w.lines, w.taxRatePct);
  assert.deepEqual(totals, { subtotal: 1300, taxAmount: 130, total: 1430 });

  assert.throws(() => sanitizeInvoiceWrite({ clientName: "x", currency: "USD" }), (e) => e instanceof InvoiceError && /number/.test((e as Error).message));
  assert.throws(() => sanitizeInvoiceWrite({ number: "1", clientName: "x", currency: "dollars" }), (e) => e instanceof InvoiceError && /currency/.test((e as Error).message));
  assert.throws(() => sanitizeInvoiceWrite({ number: "1", clientName: "x", currency: "USD", storage: "project" }), (e) => e instanceof InvoiceError && /projectId/.test((e as Error).message));
});

test("ids are self-describing (project/org only) and round-trip", () => {
  assert.deepEqual(parseInvoiceId(makeInvoiceId("project", "abc", "P1")), { storage: "project", projectId: "P1", localId: "abc" });
  assert.equal(parseInvoiceId("user~x~y"), null); // invoices are never personal
});

test("newInvoiceRow derives totals + starts draft; mergeInvoiceRow bumps version + recomputes", () => {
  const w = sanitizeInvoiceWrite({ number: "INV-1", clientName: "Acme", currency: "USD", storage: "org", lines: [{ kind: "fixed", description: "Setup", quantity: 1, unitPrice: 500 }] });
  const row = newInvoiceRow(makeInvoiceId("org", "i1"), w, ctx, "2026-01-01T00:00:00Z");
  assert.equal(row.status, "draft");
  assert.equal(row.total, 500);
  assert.equal(row.ownerSub, "u1");
  assert.equal(invoiceMeta(row).lineCount, 1);

  const w2 = sanitizeInvoiceWrite({ number: "INV-1", clientName: "Acme", currency: "USD", storage: "org", lines: [line({ kind: "labour", quantity: 8, unitPrice: 100 })].map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })) });
  const merged = mergeInvoiceRow(row, w2, ctx, "2026-02-01T00:00:00Z");
  assert.equal(merged.version, 2);
  assert.equal(merged.total, 800);
  assert.equal(merged.createdAt, row.createdAt);
});
