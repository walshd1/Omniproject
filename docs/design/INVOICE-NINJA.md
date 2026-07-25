# Invoice Ninja integration — a billing system-of-record bridge

**Status:** design note. How OmniProject syncs its (already-existing) invoices to Invoice Ninja and reads
payment/status back, without holding vendor credentials or storing money at rest in the gateway.

## 0. Premise

OmniProject already owns invoicing: `lib/invoice.ts` is a sealed, zero-at-rest `Invoice` with a
draft→issued→paid state machine, labour/expense/fixed/discount line kinds, and a full money/currency/FX
stack (`lib/currency.ts`, `fx-fallback`, `round2`/`formatMoney`). Rate cards + approved timesheets already
blend into a `staff-cost` roll-up. So this is **not "build invoicing" — it's a sync/bridge** to an external
billing system of record.

## 1. Transport: broker passthrough, not a direct client, not the neutral contract

Outbound calls go through the generic broker passthrough — `brokerCommand(ctx, "invoice-ninja.<op>", payload,
"invoicing")` — for three reasons:

1. **Keep the neutral contract clean.** The broker's `ContractAction` vocabulary is deliberately
   project/issue-centric (`list_projects`, `create_issue`, …). A finance vocabulary would bloat a PM-focused
   contract every backend implements. The passthrough takes a free-form action string, so the finance domain
   stays out of the neutral contract.
2. **Zero-at-rest credentials.** The Invoice Ninja v5 API token (`X-API-Token`) lives in the **broker's**
   secret store — the operator's n8n workflow that handles `invoice-ninja.*` holds `INVOICE_NINJA_TOKEN`. The
   gateway never holds the vendor credential (unlike a direct `safeFetch` client, which would force the token
   into the gateway vault).
3. **Guarded by construction.** The passthrough is already wrapped by the always-on autonomous-write guard.

The operator authors ONE n8n workflow: receive `invoice-ninja.<op>` → call the Invoice Ninja v5 REST API →
return the result. This bridge only produces the vendor-shaped payload and dispatches the op.

## 2. Operations (namespaced)

`invoice-ninja.upsert_invoice` · `get_invoice` · `list_invoices` · `upsert_client` · `upsert_product` ·
`upsert_expense`. Inbound payment/status events arrive via the operator's n8n workflow re-posting to
`POST /api/notifications/ingest`, matched back to the local invoice by the `custom_value1` correlation key
(`omni:<invoiceId>`), and drive the existing `POST /invoices/:id/status` (issued→paid).

## 3. Correlation

Every pushed invoice carries `custom_value1 = omni:<invoiceId>` (an Invoice Ninja custom field). The inbound
webhook handler parses that back (`parseNinjaCorrelation`) to find the local invoice — so status flows back
without the gateway storing any external id mapping at rest beyond what rides the sealed invoice artifact.

## 4. Gating

Opt-in on both sides: the `invoicing` feature module (checked at the route) AND the `INVOICE_NINJA_SYNC`
deploy flag (this module emits outbound commands the operator must have wired an n8n workflow for). Routes are
manager+ RBAC, reusing `sanitizeInvoiceWrite` + the sealed artifact store as the authoritative local record.

## 5. Build phases

1. **Bridge foundation — BUILT.** `lib/invoice-ninja.ts`: config gate (`invoiceNinjaSyncEnabled`), the
   namespaced `ninjaCommand` dispatch via the broker passthrough, the pure `Invoice → NinjaInvoicePayload`
   mapping (`toNinjaInvoice`/`toNinjaLine`, discounts signed, local totals intentionally not sent — Invoice
   Ninja recomputes), and the `omni:<id>` correlation helpers.
2. **Outbound push.** A manager-gated command that pushes a local invoice and records the returned external
   id / number / PDF link back on the sealed invoice artifact.
3. **Auto-build from time × rate.** Seed a draft invoice from approved timesheets × rate card (labour) +
   expenses (reusing `staff-cost`/actuals); editable, then pushable.
4. **Inbound webhook.** Invoice Ninja payment/paid events → n8n → `/notifications/ingest` → drive
   `POST /invoices/:id/status`, signature-verified, matched by correlation.
5. **Client + product/expense mirror.** Two-way sync of clients/products/expenses + pull-back of invoice
   numbers/PDF links.
