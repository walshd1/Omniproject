import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole, hasRole } from "../lib/rbac";
import { artifactStoreEnabled, requireArtifactStore } from "../lib/artifact-store";
import { getCommunityMarketplace } from "../lib/community-marketplace";
import {
  sanitizeRegistrySubmit, newRegistryItem, reviewRegistryItem, releaseRegistryItem, retractRegistryItem,
  registryItemMeta, listRegistryItems, getRegistryItem, putRegistryItem, deleteRegistryItem, RegistryError,
  type RegistryItem, type RegistryItemMeta,
} from "../lib/registry";
import { activateApprovedPrimitive, deactivateApprovedPrimitive, DefError } from "../lib/def-import";
import { validatePrimitiveDef, primitiveSafetyErrors } from "@workspace/backend-catalogue";

/** Shape + safety check a primitive submission (the lighter gate at submit time; activation re-checks + resolves
 *  ancestry on approval). Returns an error string, or null when the payload is a well-formed, safe primitive. */
function primitiveSubmitError(payload: unknown): string | null {
  const shape = validatePrimitiveDef(payload);
  if (!shape.ok || !shape.def) return shape.errors.join("; ") || "invalid primitive";
  const safety = primitiveSafetyErrors(shape.def);
  return safety.length ? safety.join("; ") : null;
}

/**
 * ORG REGISTRY routes (org-wide store of approved bespoke items), behind the default-off `registry` module.
 * Flow: submit (contributor+) → review approve/reject (admin) → optionally release to the community (admin;
 * calls the community-marketplace seam — a no-op until a real online marketplace is connected). Read is
 * viewer+, but a non-admin only sees APPROVED items + their OWN submissions (admins see the whole queue).
 * Items are pure-JSON building blocks — no executable code.
 *
 * NB: the repo's `reference-designs/` are commented SKELETONS for admins/devs to copy & adapt — never loaded
 * or served by the app. There is deliberately no reference endpoint here.
 */
const router = Router();

const callerLabel = (req: Parameters<typeof contextFromReq>[0]): string | null => {
  const ctx = contextFromReq(req);
  return ctx.email ?? ctx.name ?? ctx.sub ?? null;
};

/** What a caller may see: everything for an admin; else approved items + their own submissions. */
function visibleTo(req: Parameters<typeof contextFromReq>[0], items: RegistryItem[]): RegistryItem[] {
  if (hasRole(req, "admin")) return items;
  const me = callerLabel(req);
  return items.filter((it) => it.approvalStatus === "approved" || (me && it.submittedBy === me));
}

// GET /api/registry/community/status — whether a community marketplace is connected (viewer+).
router.get("/registry/community/status", requireRole("viewer"), (_req, res) => {
  const cm = getCommunityMarketplace();
  res.json({ connected: cm.configured(), name: cm.name() });
});

// GET /api/registry?kind=&status=&visibility= — the visible items (payload omitted) (viewer+).
router.get("/registry", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_registry failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const kind = req.query["kind"]; const status = req.query["status"]; const visibility = req.query["visibility"];
    let items = visibleTo(req, listRegistryItems());
    if (typeof kind === "string") items = items.filter((i) => i.kind === kind);
    if (typeof status === "string") items = items.filter((i) => i.approvalStatus === status);
    if (typeof visibility === "string") items = items.filter((i) => i.visibility === visibility);
    const metas: RegistryItemMeta[] = items.map(registryItemMeta);
    res.json(metas);
  }),
);

// GET /api/registry/:id — one item with its payload (viewer+, subject to visibility).
router.get("/registry/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_registry_item failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Item not found" }); return; }
    const item = getRegistryItem(String(req.params["id"]));
    if (!item || visibleTo(req, [item]).length === 0) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(item);
  }),
);

// POST /api/registry — submit an item for review (contributor+).
router.post("/registry", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeRegistrySubmit(req.body); }
  catch (e) { if (e instanceof RegistryError) { res.status(400).json({ error: e.message }); return; } throw e; }
  // A primitive submission is shape- + safety-checked up front, so the review queue only ever holds a
  // well-formed, injection-free primitive (activation on approval re-checks and resolves its ancestry).
  if (input.kind === "primitive") {
    const err = primitiveSubmitError(input.payload);
    if (err) { res.status(400).json({ error: `primitive is not valid: ${err}` }); return; }
  }
  return withBrokerErrors(req, res, "submit_registry failed", async () => {
    if (!requireArtifactStore(res)) return;
    const row = newRegistryItem(crypto.randomUUID(), input, contextFromReq(req), new Date().toISOString());
    putRegistryItem(row);
    res.status(201).json(row);
  });
});

// POST /api/registry/:id/review — approve or reject a submission (admin — a governance decision).
router.post("/registry/:id/review", requireRole("admin"), (req, res) => {
  const decision = (req.body ?? {})["decision"];
  if (decision !== "approved" && decision !== "rejected") { res.status(400).json({ error: "decision must be approved or rejected" }); return; }
  const note = typeof (req.body ?? {})["note"] === "string" ? (req.body["note"] as string).slice(0, 2000) : null;
  return withBrokerErrors(req, res, "review_registry failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Item not found" }); return; }
    const existing = getRegistryItem(String(req.params["id"]));
    if (!existing) { res.status(404).json({ error: "Item not found" }); return; }
    const now = new Date().toISOString();
    // ACTIVATION: approving a primitive writes it into the org's def scope (a scoped shadow, safety-re-checked +
    // ancestry-resolved); rejecting removes any previously-activated def. Activation runs BEFORE the status is
    // persisted, so a primitive that can't be safely activated is refused (400) and stays a draft.
    if (existing.kind === "primitive") {
      if (decision === "approved") {
        try { activateApprovedPrimitive(existing.id, existing.name, existing.payload, contextFromReq(req), now); }
        catch (e) { if (e instanceof DefError) { res.status(400).json({ error: e.message }); return; } throw e; }
      } else {
        deactivateApprovedPrimitive(existing.id);
      }
    }
    const row = reviewRegistryItem(existing, decision, contextFromReq(req), note, now);
    putRegistryItem(row);
    res.json(row);
  });
});

// POST /api/registry/:id/release — release an APPROVED item to the community (admin). Calls the marketplace
// seam best-effort; the item is marked `community` locally regardless (queued until a marketplace connects).
router.post("/registry/:id/release", requireRole("admin"), (req, res) =>
  withBrokerErrors(req, res, "release_registry failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Item not found" }); return; }
    const existing = getRegistryItem(String(req.params["id"]));
    if (!existing) { res.status(404).json({ error: "Item not found" }); return; }
    if (existing.approvalStatus !== "approved") { res.status(409).json({ error: "only an approved item can be released" }); return; }
    const publish = await getCommunityMarketplace().publish(existing);
    const row = releaseRegistryItem(existing, publish.communityRef ?? null, new Date().toISOString());
    putRegistryItem(row);
    res.json({ item: row, published: publish.ok, ...(publish.reason ? { reason: publish.reason } : {}) });
  }),
);

// POST /api/registry/:id/retract — pull a released item back to internal-only (admin).
router.post("/registry/:id/retract", requireRole("admin"), (req, res) =>
  withBrokerErrors(req, res, "retract_registry failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Item not found" }); return; }
    const existing = getRegistryItem(String(req.params["id"]));
    if (!existing) { res.status(404).json({ error: "Item not found" }); return; }
    const row = retractRegistryItem(existing, new Date().toISOString());
    putRegistryItem(row);
    res.json(row);
  }),
);

// DELETE /api/registry/:id — remove an item (admin, or the submitter while it's still a draft).
router.delete("/registry/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "delete_registry failed", async () => {
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const existing = getRegistryItem(String(req.params["id"]));
    if (!existing) { res.status(204).end(); return; }
    const isAdmin = hasRole(req, "admin");
    const isOwnDraft = existing.approvalStatus === "draft" && existing.submittedBy === callerLabel(req);
    if (!isAdmin && !isOwnDraft) { res.status(403).json({ error: "only an admin (or the submitter of a draft) can delete this item" }); return; }
    // Deleting an approved primitive also removes its activated org def, so it stops resolving.
    if (existing.kind === "primitive") deactivateApprovedPrimitive(existing.id);
    deleteRegistryItem(String(req.params["id"]));
    res.status(204).end();
  }),
);

export default router;
