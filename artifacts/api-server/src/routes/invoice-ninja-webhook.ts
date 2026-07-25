import { Router, type Request } from "express";
import { withBrokerErrors } from "../broker";
import { constantTimeEqual } from "../lib/crypto-keys";
import { artifactStoreEnabled, getArtifact, putArtifact } from "../lib/artifact-store";
import {
  INVOICE_ARTIFACT, parseInvoiceId, invoiceScope, applyInvoiceStatus, invoiceMeta, paidTransitionChain,
  type Invoice,
} from "../lib/invoice";
import { invoiceNinjaSyncEnabled, invoiceNinjaWebhookSecret, ninjaSystemContext, parseNinjaWebhook } from "../lib/invoice-ninja";

/**
 * Invoice Ninja INBOUND payment webhook (phase 4, docs/design/INVOICE-NINJA.md).
 *
 * Invoice Ninja fires a webhook when an invoice is paid; n8n forwards it here. This is the settlement half
 * of the bridge: it matches the local invoice by the `omni:<id>` correlation stamped on push (phase 2) and
 * drives it to `paid` (idempotent).
 *
 * SESSION-LESS by design — n8n / Invoice Ninja hold no OmniProject session — so this router is mounted
 * OUTSIDE `requireAuth` (like the notify ingest + SCIM routers) and self-authenticates with a dedicated
 * shared secret (`INVOICE_NINJA_WEBHOOK_SECRET`, constant-time compared). It is additionally gated by the
 * `INVOICE_NINJA_SYNC` flag and the artifact store, and only ever advances an invoice's OWN status — it
 * accepts no arbitrary field writes from the untrusted payload, only the correlation id.
 */
// Named `router` (not the export alias) so the API-reference generator documents its routes.
const router: Router = Router();
export { router as invoiceNinjaWebhookRouter };

/** The webhook secret presented by the caller — Bearer token or `x-invoice-ninja-secret` header. */
function webhookSecretFromReq(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  const token = Array.isArray(auth) ? auth[0] : auth;
  const bearer = token?.startsWith("Bearer ") ? token.slice(7) : undefined;
  const header = req.headers["x-invoice-ninja-secret"];
  const explicit = Array.isArray(header) ? header[0] : header;
  return bearer ?? explicit;
}

// POST /api/invoices/ninja-webhook — inbound settlement callback (n8n → here). Drives the correlated
// invoice to `paid` (issuing a draft first, since an external settlement implies external issuance).
router.post("/invoices/ninja-webhook", (req, res) =>
  withBrokerErrors(req, res, "ninja_webhook failed", async () => {
    if (!invoiceNinjaSyncEnabled()) { res.status(409).json({ error: "Invoice Ninja sync is not enabled (set INVOICE_NINJA_SYNC)" }); return; }
    const secret = invoiceNinjaWebhookSecret();
    if (!secret) { res.status(503).json({ error: "Invoice Ninja webhook disabled (set INVOICE_NINJA_WEBHOOK_SECRET)" }); return; }
    const provided = webhookSecretFromReq(req);
    if (!provided || !constantTimeEqual(provided, secret)) { res.status(401).json({ error: "invalid webhook secret" }); return; }
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Invoice not found" }); return; }

    const match = parseNinjaWebhook(req.body);
    if (!match) { res.status(422).json({ error: "no omni correlation on the webhook payload" }); return; }
    const parsed = parseInvoiceId(match.invoiceId);
    if (!parsed) { res.status(404).json({ error: "Invoice not found" }); return; }
    const ctx = ninjaSystemContext();
    const scope = invoiceScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Invoice>(INVOICE_ARTIFACT, scope, match.invoiceId) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Invoice not found" }); return; }

    const chain = paidTransitionChain(existing.status);
    if (chain === null) { res.status(409).json({ error: "cannot settle a void invoice" }); return; }
    if (chain.length === 0) { res.json(invoiceMeta(existing)); return; } // already paid — idempotent
    const now = new Date().toISOString();
    let row: Invoice = existing;
    for (const step of chain) row = applyInvoiceStatus(row, step, ctx, now);
    putArtifact(INVOICE_ARTIFACT, scope, row);
    res.json(invoiceMeta(row));
  }),
);
