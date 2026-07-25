import { Router, type Request, type Response } from "express";
import { withBrokerErrors } from "../broker";
import { resolveBillingAdapter, allLegacyWebhookPaths, allLegacyWebhookHeaders } from "../broker/backends";
import { constantTimeEqual } from "../lib/crypto-keys";
import { artifactStoreEnabled, getArtifact, putArtifact } from "../lib/artifact-store";
import {
  INVOICE_ARTIFACT, parseInvoiceId, invoiceScope, applyInvoiceStatus, applyInvoicePayment, invoiceMeta,
  paidTransitionChain, type Invoice,
} from "../lib/invoice";

/**
 * INBOUND settlement webhook for the connected billing backend (finance superset; docs/design/INVOICE-NINJA.md).
 *
 * A billing backend fires a webhook when an invoice is paid; the broker (n8n) forwards it here. This is the
 * settlement half of the sync: it matches the local invoice by the correlation the adapter stamped on push
 * and drives it to `paid` (idempotent). The route is backend-vendor-NEUTRAL — it resolves the active adapter
 * through the billing seam and never names a vendor; the vendor-shaped secret check and payload parse live in
 * the adapter (broker/backends/<vendor>.ts).
 *
 * SESSION-LESS by design — the backend / broker hold no OmniProject session — so this router is mounted
 * OUTSIDE `requireAuth` (like the notify ingest + SCIM routers) and self-authenticates with the adapter's
 * dedicated shared secret (constant-time compared). It is additionally gated by the adapter's sync flag and
 * the artifact store, and only ever advances an invoice's OWN status — it accepts no arbitrary field writes
 * from the untrusted payload, only the correlation id.
 *
 * The canonical path is `POST /api/invoices/billing-webhook`; each adapter's original vendor-named path is
 * also mounted as a back-compat alias (from adapter data — no vendor name appears in this file).
 */
// Named `router` (not the export alias) so the API-reference generator documents its routes.
const router: Router = Router();
export { router as billingWebhookRouter };

/** The webhook secret presented by the caller — Bearer token or the neutral `x-billing-webhook-secret`
 *  header, plus each adapter's legacy vendor-named header (from adapter data — no vendor name here). */
function webhookSecretFromReq(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  const token = Array.isArray(auth) ? auth[0] : auth;
  const bearer = token?.startsWith("Bearer ") ? token.slice(7) : undefined;
  if (bearer) return bearer;
  for (const name of ["x-billing-webhook-secret", ...allLegacyWebhookHeaders()]) {
    const headerVal = req.headers[name];
    const explicit = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (explicit) return explicit;
  }
  return undefined;
}

// Inbound settlement callback (broker → here). Drives the correlated invoice to `paid` (issuing a draft
// first, since an external settlement implies external issuance).
const handleWebhook = (req: Request, res: Response) =>
  withBrokerErrors(req, res, "billing_webhook failed", async () => {
    const billing = resolveBillingAdapter();
    if (!billing?.enabled()) { res.status(409).json({ error: "Billing sync is not enabled for the connected backend" }); return; }
    const secret = billing.webhookSecret();
    if (!secret) { res.status(503).json({ error: "Billing webhook disabled (no webhook secret configured)" }); return; }
    const provided = webhookSecretFromReq(req);
    if (!provided || !constantTimeEqual(provided, secret)) { res.status(401).json({ error: "invalid webhook secret" }); return; }
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Invoice not found" }); return; }

    const match = billing.parseWebhook(req.body);
    if (!match) { res.status(422).json({ error: "no correlation on the webhook payload" }); return; }
    const parsed = parseInvoiceId(match.invoiceId);
    if (!parsed) { res.status(404).json({ error: "Invoice not found" }); return; }
    const ctx = billing.systemContext();
    const scope = invoiceScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Invoice>(INVOICE_ARTIFACT, scope, match.invoiceId) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (existing.status === "void") { res.status(409).json({ error: "cannot settle a void invoice" }); return; }
    const now = new Date().toISOString();

    // With a settlement amount (finance superset F3) → apply a payment (partial payments accumulate; the
    // invoice flips to paid only once the balance reaches zero). Without one → settle in full (phase-4).
    let row: Invoice;
    if (match.amount != null) {
      row = applyInvoicePayment(existing, match.amount, ctx, now);
    } else {
      const chain = paidTransitionChain(existing.status);
      if (chain === null) { res.status(409).json({ error: "cannot settle a void invoice" }); return; }
      if (chain.length === 0) { res.json(invoiceMeta(existing)); return; } // already paid — idempotent
      row = existing;
      for (const step of chain) row = applyInvoiceStatus(row, step, ctx, now);
    }
    putArtifact(INVOICE_ARTIFACT, scope, row);
    res.json(invoiceMeta(row));
  });

// The canonical neutral path (documented + statically analysable) …
router.post("/invoices/billing-webhook", handleWebhook);
// … plus every adapter's original vendor-named path as a back-compat alias (from adapter data — no vendor
// name appears here). Runtime route reflection still sees these, so the write-lane ratchet covers them.
for (const path of allLegacyWebhookPaths()) router.post(path, handleWebhook);
