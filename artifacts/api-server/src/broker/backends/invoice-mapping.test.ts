import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type InvoiceSyncSpec, correlationValue, parseCorrelation, projectOutbound, parseExternalRef, parsePaid,
  parseWebhook, syncEnabled, webhookSecret,
} from "./invoice-mapping";

/**
 * Parity spec for the generic projector, driven by the Invoice Ninja advertised mapping inline here. Every
 * assertion mirrors one the hand-written invoice-ninja bridge used to make — proving the data-driven engine
 * reproduces the exact vendor behaviour with no vendor code.
 */
const IN_SPEC: InvoiceSyncSpec = {
  correlation: { field: "custom_value1", altFields: ["correlation"] },
  env: { enable: ["INVOICE_NINJA_SYNC"], webhookSecret: ["INVOICE_NINJA_WEBHOOK_SECRET"] },
  outbound: {
    fields: [
      { to: "number", from: "number" },
      { to: "client_name", from: "clientName" },
      { to: "currency_code", from: "currency" },
      { to: "tax_rate1", from: "taxRatePct" },
      { to: "tax_name1", from: "taxRatePct", transform: "const-when-gt", gt: 0, then: "Tax", else: "" },
      { to: "due_date", from: "dueAt", transform: "date-only" },
      { to: "public_notes", from: "note" },
    ],
    lines: {
      to: "line_items", from: "lines",
      fields: [
        { to: "type_id", from: "kind", transform: "map", map: { labour: "2" }, default: "1" },
        { to: "product_key", from: "kind" },
        { to: "notes", from: "description" },
        { to: "cost", from: "unitPrice", transform: "sign-when", whenField: "kind", equals: "discount" },
        { to: "quantity", from: "quantity" },
      ],
    },
    correlationTo: "custom_value1",
  },
  inbound: {
    unwrap: ["data"],
    id: "id",
    number: "number",
    pdf: "invitations.0.link",
    paid: {
      anyOf: [
        { field: "status_id", equalsAny: [4, "4"] },
        { allOf: [{ field: "balance", finite: true, lte: 0 }, { field: "paid_to_date", finite: true, gt: 0 }] },
      ],
    },
  },
  webhook: {
    wrappers: ["data", "invoice", "payload"],
    arrayWrappers: ["data", "payload"],
    invoicesKey: "invoices",
    amountWrappers: ["data", "payload"],
    amountField: "amount",
  },
};

const line = (over: Record<string, unknown> = {}) => ({ id: "l1", kind: "labour", description: "Design work", quantity: 10, unitPrice: 100, amount: 1000, ...over });
const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv_abc", number: "INV-001", clientName: "Acme Ltd", currency: "USD", taxRatePct: 20,
  note: "Thanks", dueAt: "2026-08-01T00:00:00.000Z", lines: [line()], ...over,
});

test("correlation round-trips and rejects foreign values", () => {
  assert.equal(correlationValue("inv_abc"), "omni:inv_abc");
  assert.equal(parseCorrelation("omni:inv_abc"), "inv_abc");
  assert.equal(parseCorrelation("something-else"), null);
  assert.equal(parseCorrelation("omni:"), null);
  assert.equal(parseCorrelation(42), null);
});

test("outbound line mapping: kind→type_id, product_key, signed discount", () => {
  const out = projectOutbound(invoice({ lines: [line({ kind: "labour" })] }), IN_SPEC);
  assert.deepEqual((out["line_items"] as unknown[])[0], { type_id: "2", product_key: "labour", notes: "Design work", cost: 100, quantity: 10 });
  assert.equal((projectOutbound(invoice({ lines: [line({ kind: "expense" })] }), IN_SPEC)["line_items"] as any)[0].type_id, "1");
  assert.equal((projectOutbound(invoice({ lines: [line({ kind: "fixed" })] }), IN_SPEC)["line_items"] as any)[0].type_id, "1");
  assert.equal((projectOutbound(invoice({ lines: [line({ kind: "discount", unitPrice: 50 })] }), IN_SPEC)["line_items"] as any)[0].cost, -50);
});

test("outbound invoice payload is faithful and omits local totals", () => {
  const n = projectOutbound(invoice(), IN_SPEC);
  assert.equal(n["number"], "INV-001");
  assert.equal(n["client_name"], "Acme Ltd");
  assert.equal(n["currency_code"], "USD");
  assert.equal(n["tax_rate1"], 20);
  assert.equal(n["tax_name1"], "Tax");
  assert.equal(n["due_date"], "2026-08-01");
  assert.equal(n["custom_value1"], "omni:inv_abc");
  assert.equal(n["public_notes"], "Thanks");
  assert.equal((n["line_items"] as unknown[]).length, 1);
  assert.equal("subtotal" in n, false);
  assert.equal("total" in n, false);
});

test("no tax → empty tax name + zero rate; null due date passes through", () => {
  const n = projectOutbound(invoice({ taxRatePct: 0, dueAt: null }), IN_SPEC);
  assert.equal(n["tax_name1"], "");
  assert.equal(n["tax_rate1"], 0);
  assert.equal(n["due_date"], null);
});

const NOW = "2026-07-25T02:00:00.000Z";

test("parseExternalRef reads {data}, number, portal link; tolerates bare + numeric id; null when no id", () => {
  assert.deepEqual(
    parseExternalRef({ data: { id: "IN-9", number: "0001", invitations: [{ link: "https://in.example/x" }] } }, IN_SPEC, "invoice-ninja", NOW),
    { system: "invoice-ninja", id: "IN-9", number: "0001", pdfUrl: "https://in.example/x", pushedAt: NOW },
  );
  assert.deepEqual(parseExternalRef({ id: 42 }, IN_SPEC, "invoice-ninja", NOW), { system: "invoice-ninja", id: "42", number: null, pdfUrl: null, pushedAt: NOW });
  assert.equal(parseExternalRef({ data: {} }, IN_SPEC, "invoice-ninja", NOW), null);
  assert.equal(parseExternalRef(null, IN_SPEC, "invoice-ninja", NOW), null);
  assert.equal(parseExternalRef("nope", IN_SPEC, "invoice-ninja", NOW), null);
});

test("parsePaid reads status_id (4/'4'), {data} wrapper, and a zeroed balance", () => {
  assert.equal(parsePaid({ status_id: 4 }, IN_SPEC), "paid");
  assert.equal(parsePaid({ status_id: "4" }, IN_SPEC), "paid");
  assert.equal(parsePaid({ data: { status_id: 4 } }, IN_SPEC), "paid");
  assert.equal(parsePaid({ balance: 0, paid_to_date: 1200 }, IN_SPEC), "paid");
  assert.equal(parsePaid({ balance: -0.0, paid_to_date: 5 }, IN_SPEC), "paid");
  assert.equal(parsePaid({ status_id: 2 }, IN_SPEC), null);
  assert.equal(parsePaid({ balance: 100, paid_to_date: 0 }, IN_SPEC), null);
  assert.equal(parsePaid({ balance: 0, paid_to_date: 0 }, IN_SPEC), null);
  assert.equal(parsePaid({}, IN_SPEC), null);
  assert.equal(parsePaid(null, IN_SPEC), null);
  assert.equal(parsePaid("nope", IN_SPEC), null);
});

test("parseWebhook pulls the omni id from wrappers / invoices[] / correlation, with optional amount", () => {
  assert.deepEqual(parseWebhook({ custom_value1: correlationValue("proj~p1~inv9"), status_id: "4" }, IN_SPEC), { invoiceId: "proj~p1~inv9", amount: null });
  assert.deepEqual(parseWebhook({ data: { custom_value1: "omni:org~inv1" } }, IN_SPEC), { invoiceId: "org~inv1", amount: null });
  assert.deepEqual(parseWebhook({ invoice: { custom_value1: "omni:org~inv2" } }, IN_SPEC), { invoiceId: "org~inv2", amount: null });
  assert.deepEqual(parseWebhook({ payload: { custom_value1: "omni:org~inv3" } }, IN_SPEC), { invoiceId: "org~inv3", amount: null });
  assert.deepEqual(parseWebhook({ event_type: "payment", invoices: [{ id: "IN-1", custom_value1: "omni:org~inv4" }] }, IN_SPEC), { invoiceId: "org~inv4", amount: null });
  assert.deepEqual(parseWebhook({ data: { invoices: [{ custom_value1: "omni:org~inv5" }] } }, IN_SPEC), { invoiceId: "org~inv5", amount: null });
  assert.deepEqual(parseWebhook({ correlation: "omni:org~inv6" }, IN_SPEC), { invoiceId: "org~inv6", amount: null });
  assert.deepEqual(parseWebhook({ custom_value1: "omni:org~inv7", amount: 250 }, IN_SPEC), { invoiceId: "org~inv7", amount: 250 });
  assert.deepEqual(parseWebhook({ data: { custom_value1: "omni:org~inv8", amount: "99.50" } }, IN_SPEC), { invoiceId: "org~inv8", amount: 99.5 });
  assert.deepEqual(parseWebhook({ custom_value1: "omni:org~inv9", amount: 0 }, IN_SPEC), { invoiceId: "org~inv9", amount: null });
  assert.equal(parseWebhook({ custom_value1: "someone-elses-ref" }, IN_SPEC), null);
  assert.equal(parseWebhook({ status_id: "4" }, IN_SPEC), null);
  assert.equal(parseWebhook(null, IN_SPEC), null);
  assert.equal(parseWebhook("nope", IN_SPEC), null);
  assert.equal(parseWebhook({ invoices: [] }, IN_SPEC), null);
});

test("env helpers honour the advertised flags", () => {
  assert.equal(syncEnabled(IN_SPEC, { INVOICE_NINJA_SYNC: "1" }), true);
  assert.equal(syncEnabled(IN_SPEC, { INVOICE_NINJA_SYNC: "true" }), true);
  assert.equal(syncEnabled(IN_SPEC, { INVOICE_NINJA_SYNC: "on" }), true);
  assert.equal(syncEnabled(IN_SPEC, { INVOICE_NINJA_SYNC: "0" }), false);
  assert.equal(syncEnabled(IN_SPEC, {}), false);
  assert.equal(webhookSecret(IN_SPEC, { INVOICE_NINJA_WEBHOOK_SECRET: "  s3cret  " }), "s3cret");
  assert.equal(webhookSecret(IN_SPEC, { INVOICE_NINJA_WEBHOOK_SECRET: "   " }), undefined);
  assert.equal(webhookSecret(IN_SPEC, {}), undefined);
});
