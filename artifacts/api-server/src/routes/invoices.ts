import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import {
  artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact,
} from "../lib/artifact-store";
import {
  INVOICE_ARTIFACT, sanitizeInvoiceWrite, makeInvoiceId, parseInvoiceId, invoiceScope,
  newInvoiceRow, mergeInvoiceRow, invoiceMeta, isInvoiceStatus, canTransitionInvoice, applyInvoiceStatus, InvoiceError,
  type Invoice, type InvoiceMeta, type InvoiceStorage,
} from "../lib/invoice";

/**
 * INVOICES (roadmap 3.3). A generated, client-facing invoice — a number + currency + typed line primitives,
 * with amounts + totals derived server-side. Saved to a STORAGE TARGET (a PROJECT's or the ORG-wide
 * encrypted-JSON area, AES-256-GCM sealed) — the storage-target pattern, minus user/sidecar (an invoice is
 * never personal). Ids are self-describing. Every write passes the one choke point (`sanitizeInvoiceWrite`).
 * Invoices are financial documents ⇒ RBAC is manager+ throughout (org writes additionally gated by the
 * storage-target authz). Behind the default-off `invoicing` feature module.
 */
const router = Router();

const authorizeTarget = (
  req: Parameters<typeof authorizeStorageTarget>[0], res: Parameters<typeof authorizeStorageTarget>[1],
  storage: InvoiceStorage, projectId: string | undefined, op: "read" | "write",
): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, { capability: false, capabilityError: "invoices are not stored in the sidecar" });

// GET /api/invoices?projectId= — invoices (lines omitted) across the org + a project store (manager+).
router.get("/invoices", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "list_invoices failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const metas: InvoiceMeta[] = [];
    for (const inv of listArtifacts<Invoice>(INVOICE_ARTIFACT, { kind: "org" })) metas.push(invoiceMeta(inv));
    if (projectId && (await assertProjectScope(req, projectId)).ok) {
      for (const inv of listArtifacts<Invoice>(INVOICE_ARTIFACT, { kind: "project", projectId })) metas.push(invoiceMeta(inv));
    }
    res.json(metas);
  }),
);

// GET /api/invoices/:id — one invoice with its lines (manager+).
router.get("/invoices/:id", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "get_invoice failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseInvoiceId(id);
    if (!parsed || !artifactStoreEnabled()) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const scope = invoiceScope(parsed, contextFromReq(req).sub);
    const invoice = scope ? getArtifact<Invoice>(INVOICE_ARTIFACT, scope, id) : null;
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(invoice);
  }),
);

// POST /api/invoices — create an invoice in the chosen storage target (manager+).
router.post("/invoices", requireRole("manager"), (req, res) => {
  let input;
  try { input = sanitizeInvoiceWrite(req.body); }
  catch (e) { if (e instanceof InvoiceError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_invoice failed", async () => {
    if (!(await authorizeTarget(req, res, input.storage, input.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const ctx = contextFromReq(req);
    const scope = invoiceScope(input, ctx.sub);
    if (!scope) { res.status(400).json({ error: "invalid storage target" }); return; }
    const id = makeInvoiceId(input.storage, crypto.randomUUID(), input.projectId);
    const row = newInvoiceRow(id, input, ctx, new Date().toISOString());
    putArtifact(INVOICE_ARTIFACT, scope, row);
    res.status(201).json(row);
  });
});

// PUT /api/invoices/:id — update an invoice in place; only a DRAFT may be edited (manager+).
router.put("/invoices/:id", requireRole("manager"), (req, res) => {
  let input;
  try { input = sanitizeInvoiceWrite(req.body); }
  catch (e) { if (e instanceof InvoiceError) { res.status(400).json({ error: e.message }); return; } throw e; }
  const id = String(req.params["id"]);
  const parsed = parseInvoiceId(id);
  if (!parsed) { res.status(404).json({ error: "Invoice not found" }); return; }
  return withBrokerErrors(req, res, "update_invoice failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Invoice not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = invoiceScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Invoice>(INVOICE_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (existing.status !== "draft") { res.status(409).json({ error: "only a draft invoice can be edited" }); return; }
    const row = mergeInvoiceRow(existing, input, ctx, new Date().toISOString());
    putArtifact(INVOICE_ARTIFACT, scope, row);
    res.json(row);
  });
});

// POST /api/invoices/:id/status — transition an invoice (draft→issued→paid; live→void) (manager+).
router.post("/invoices/:id/status", requireRole("manager"), (req, res) => {
  const next = (req.body ?? {})["status"];
  if (!isInvoiceStatus(next)) { res.status(400).json({ error: "status must be draft, issued, paid or void" }); return; }
  const id = String(req.params["id"]);
  const parsed = parseInvoiceId(id);
  if (!parsed) { res.status(404).json({ error: "Invoice not found" }); return; }
  return withBrokerErrors(req, res, "transition_invoice failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Invoice not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = invoiceScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Invoice>(INVOICE_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (!canTransitionInvoice(existing.status, next)) { res.status(409).json({ error: `cannot move a ${existing.status} invoice to ${next}` }); return; }
    const row = applyInvoiceStatus(existing, next, ctx, new Date().toISOString());
    putArtifact(INVOICE_ARTIFACT, scope, row);
    res.json(row);
  });
});

// DELETE /api/invoices/:id — remove an invoice (manager+).
router.delete("/invoices/:id", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "delete_invoice failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseInvoiceId(id);
    if (!parsed) { res.status(204).end(); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const scope = invoiceScope(parsed, contextFromReq(req).sub);
    if (scope) deleteArtifact(INVOICE_ARTIFACT, scope, id);
    res.status(204).end();
  }),
);

export default router;
