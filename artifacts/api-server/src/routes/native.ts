import { Router } from "express";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { enforceBusinessRules } from "../lib/ruleset-guard";
import { recordRequestAudit } from "../lib/audit";
import { sanitizeHandoffRequest, sanitizeImportRequest, NativeHandoffError } from "../lib/native-handoff";

/**
 * NATIVE HANDOFF routes (companion-app bridge, roadmap X.1 — see docs/NATIVE-HANDOFF.md), behind the
 * default-off `nativeHandoff` module. Thin shells over the OPTIONAL broker methods: advertise the native
 * surfaces a connected backend fronts, mint a vetted (host-allowlisted) vendor handoff URL, and bring the
 * artifact back THROUGH the broker as a reference attachment. A new connector capability, not a new boundary:
 * the URL is connector-minted (never user-typed), and the reimport is a normal RBAC-scoped, audited broker op.
 */
const router = Router();

// GET /api/native/surfaces — the native surfaces connected backends front (viewer+; empty when none).
router.get("/native/surfaces", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "native_surfaces failed", async () => {
    const broker = getBroker();
    if (!broker.nativeSurfaces) { res.json([]); return; }
    res.json(await broker.nativeSurfaces(contextFromReq(req)));
  }),
);

// POST /api/native/handoff — mint the vetted vendor handoff URL (contributor+).
router.post("/native/handoff", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeHandoffRequest(req.body); }
  catch (e) { if (e instanceof NativeHandoffError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "native_handoff failed", async () => {
    const broker = getBroker();
    if (!broker.nativeHandoff) { res.status(501).json({ error: "this backend does not support native handoff" }); return; }
    const handoff = await broker.nativeHandoff(contextFromReq(req), input);
    recordRequestAudit(req, { category: "request", action: "native.handoff", write: false, meta: { vendor: input.vendor, kind: input.kind, action: input.action } });
    res.json(handoff);
  });
});

// POST /api/native/import — bring the native artifact back as a reference attachment (contributor+).
router.post("/native/import", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeImportRequest(req.body); }
  catch (e) { if (e instanceof NativeHandoffError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "native_import failed", async () => {
    const broker = getBroker();
    if (!broker.nativeImport) { res.status(501).json({ error: "this backend does not support native import" }); return; }
    if (!enforceBusinessRules(req, res, "native_import", { projectId: input.target.projectId ?? null, payload: input as unknown as Record<string, unknown> })) return;
    const attachment = await broker.nativeImport(contextFromReq(req), input);
    recordRequestAudit(req, { category: "request", action: "native.import", write: true, meta: { vendor: input.vendor, kind: input.kind, projectId: input.target.projectId } });
    res.status(201).json(attachment);
  });
});

export default router;
