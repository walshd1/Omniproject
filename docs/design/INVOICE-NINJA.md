# Invoice Ninja integration — a billing system-of-record bridge

**Status:** design note. How OmniProject syncs its (already-existing) invoices to Invoice Ninja and reads
payment/status back, without holding vendor credentials or storing money at rest in the gateway.

## 0. Premise

OmniProject already owns invoicing: `lib/invoice.ts` is a sealed, zero-at-rest `Invoice` with a
draft→issued→paid state machine, labour/expense/fixed/discount line kinds, and a full money/currency/FX
stack (`lib/currency.ts`, `fx-fallback`, `round2`/`formatMoney`). Rate cards + approved timesheets already
blend into a `staff-cost` roll-up. So this is **not "build invoicing" — it's a sync/bridge** to an external
billing system of record.

## 1. Invoice Ninja is just another backend

Invoice Ninja is modelled as a catalogue **backend** — the same plane as Jira / OpenProject / Dolibarr — not
a bespoke integration. It implements a SUBSET of the broker contract: the invoice verbs (`create_invoice`,
`update_invoice`, `get_invoice`, `list_invoices`), gated by the `financials` capability. It does NOT implement
the issue/project verbs (it isn't a PM tool) — the `actions` map is `Partial`, so that's legal. The contract
gained these finance verbs (`backend-manifest.ts`) so a billing system of record is a first-class backend, and
Dolibarr/Odoo/NetSuite could implement the same verbs once the catalogue freeze lifts.

Because it's a backend:
- its n8n workflow is **GENERATED** from the vendor def (like every backend), not hand-authored;
- the Invoice Ninja v5 API token (`X-API-Token`) lives in the **broker's** secret store (an n8n Header-Auth
  credential holding `INVOICE_NINJA_TOKEN`) — the gateway stays **zero-at-rest**, never holding the credential;
- outbound dispatch is `brokerCommand(ctx, "create_invoice", payload, "invoicing")` (the contract verb),
  wrapped by the always-on autonomous-write guard.

### Shipped in the catalogue (freeze baseline raised 41 → 42)

Invoice Ninja ships in the core backend catalogue
(`lib/backend-catalogue/vendors/backends/invoice-ninja.json`). The catalogue-growth freeze
(`scripts/src/lib/backend-freeze.ts`) baseline was deliberately raised from 41 to 42 to admit it: the billing
system-of-record category (the `financials` capability) had no dedicated connector, and Invoice Ninja is
open-source + self-hostable so it can actually be verified without a paid tenant. The freeze otherwise holds —
no 43rd backend until the flagship set is `verified`.

## 2. Operations (invoice contract verbs)

`create_invoice` · `update_invoice` · `get_invoice` · `list_invoices` (client/product/expense verbs arrive in
phase 5). Inbound payment/status events arrive via the operator's n8n workflow re-posting to
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

1. **Backend registration + payload mapping — BUILT.** Invoice verbs added to the broker contract
   (`ContractAction`, `WRITE_ACTIONS`); Invoice Ninja authored as a backend def
   (`docs/vendors/overlays/invoice-ninja.json`, `financials` capability) shipped as a freeze-exempt operator
   overlay. `lib/invoice-ninja.ts`: config gate (`invoiceNinjaSyncEnabled`), `ninjaCommand` dispatch via the
   broker to the backend's contract verb, the pure `Invoice → NinjaInvoicePayload` mapping
   (`toNinjaInvoice`/`toNinjaLine`, discounts signed, local totals intentionally not sent — Invoice Ninja
   recomputes), and the `omni:<id>` correlation helpers.
2. **Outbound push.** A manager-gated command that pushes a local invoice and records the returned external
   id / number / PDF link back on the sealed invoice artifact.
3. **Auto-build from time × rate.** Seed a draft invoice from approved timesheets × rate card (labour) +
   expenses (reusing `staff-cost`/actuals); editable, then pushable.
4. **Inbound webhook.** Invoice Ninja payment/paid events → n8n → `/notifications/ingest` → drive
   `POST /invoices/:id/status`, signature-verified, matched by correlation.
5. **Client + product/expense mirror.** Two-way sync of clients/products/expenses + pull-back of invoice
   numbers/PDF links.
