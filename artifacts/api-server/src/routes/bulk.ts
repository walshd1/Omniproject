import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getBroker, contextFromReq } from "../broker";
import { assertProjectScope } from "../lib/project-scope";
import { recordRequestAudit } from "../lib/audit";
import { v, parseOr400 } from "../lib/validate";
import { runBulk, MAX_BULK_ITEMS, type BulkSpec, type BulkActionKind } from "../lib/bulk-actions";

/**
 * Declarative BULK-ACTION runner — the admin "apply one canonical write to many projects" endpoint.
 * It is NOT a scripting engine: the body is a DECLARATIVE spec that composes only the existing gated
 * broker writes (`create_project`, `update_project`), so every safeguard still applies PER item and
 * NOTHING is weakened:
 *   - off-by-default: mounted behind the `bulkActions` feature module (defaultOff) + requireFeature,
 *     so the route doesn't even exist until an admin opts in;
 *   - RBAC: requireRole("manager") — the same role POST /projects and PATCH /projects/:id demand;
 *   - step-up: a batch is high-blast-radius, so a fresh re-auth is required (requireStepUp);
 *   - broker seam: writes go through getBroker() (autonomous-guard + scope-guard + sanitizer wrapped),
 *     so no item can route around them;
 *   - business ruleset + per-target scope: evaluated PER item inside the pure runner (a freeze or an
 *     out-of-scope target skips that item, never the batch);
 *   - bounded: a hard item cap (413 over it) + a fan-out ceiling, so it can't write-amplify into a DoS.
 * Returns a per-item outcome (partial success), and supports a `dryRun` preview that writes nothing.
 */
const router = Router();

/** Allowlisted ProjectWrite fields a bulk patch/template may carry. Unknown keys are dropped by
 *  v.object (so a client-forged omniInstanceId can't ride in). `nullable` lets an external sender
 *  clear a field with an explicit null; `name` can't be cleared (it's the required create key). */
const PATCH_SHAPE = v.object({
  name: v.optional(v.string({ trim: true, min: 1, max: 300 })),
  identifier: v.nullable(v.string({ trim: true, max: 100 })),
  description: v.nullable(v.string({ max: 5000 })),
  programmeId: v.nullable(v.string({ trim: true, max: 300 })),
  status: v.nullable(v.string({ trim: true, max: 200 })),
});

const BULK_BODY = v.object({
  action: v.enum(["update_project", "create_project"] as const),
  dryRun: v.optional(v.boolean()),
  // No validator cap here — a manual length check gives a proper 413 (matching /import/commit); the
  // 256kb body limit is the backstop against an unbounded array.
  targets: v.optional(v.array(v.string({ trim: true, min: 1, max: 300 }))),
  patch: v.optional(PATCH_SHAPE),
  template: v.optional(PATCH_SHAPE),
  names: v.optional(v.array(v.string({ trim: true, min: 1, max: 300 }))),
});

/** The fields actually SET by a patch (a present, non-undefined value — an explicit null counts, as
 *  it clears the field). */
function setFields(patch: Record<string, unknown> | undefined): string[] {
  return patch ? Object.keys(patch).filter((k) => patch[k] !== undefined) : [];
}

router.post("/admin/bulk", requireRole("manager"), requireStepUp, async (req, res) => {
  const body = parseOr400(req, res, BULK_BODY);
  if (!body) return;
  const dryRun = body.dryRun === true;
  const action = body.action as BulkActionKind;

  // Per-action shape validation + the hard item cap (413) — each item is a broker write.
  let itemCount: number;
  if (action === "update_project") {
    const targets = body.targets ?? [];
    if (targets.length === 0) { res.status(400).json({ error: "update_project requires a non-empty targets[]" }); return; }
    if (setFields(body.patch).length === 0) { res.status(400).json({ error: "update_project requires a patch that sets at least one field" }); return; }
    itemCount = targets.length;
  } else {
    const names = body.names ?? [];
    if (names.length === 0) { res.status(400).json({ error: "create_project requires a non-empty names[]" }); return; }
    itemCount = names.length;
  }
  if (itemCount > MAX_BULK_ITEMS) {
    res.status(413).json({ error: `Too many items: ${itemCount} exceeds the ${MAX_BULK_ITEMS}-item bulk cap. Split the batch.` });
    return;
  }

  const role = roleForReq(req);
  const spec: BulkSpec = {
    action,
    ...(body.targets ? { targets: body.targets } : {}),
    ...(body.patch ? { patch: body.patch } : {}),
    ...(body.template ? { template: body.template } : {}),
    ...(body.names ? { names: body.names } : {}),
  };
  const outcome = await runBulk({
    broker: getBroker(),
    ctx: contextFromReq(req),
    role,
    spec,
    dryRun,
    // Per-target IDOR guard — the pure predicate form of guardProjectScope (skips an item, never
    // 403s the whole batch). Only reached for update_project (creates have no existing target).
    inScope: async (projectId) => (await assertProjectScope(req, projectId)).ok,
    onItemError: (index, err) => req.log.error({ err, index }, "bulk item failed"),
  });

  // One summary audit (category "admin" — always recorded). A dry-run is a read (write:false).
  recordRequestAudit(req, {
    category: "admin",
    action: dryRun ? "bulk_preview" : "bulk_execute",
    write: !dryRun,
    result: dryRun || outcome.applied > 0 ? "success" : "error",
    status: 200,
    meta: { action, dryRun, total: outcome.total, applied: outcome.applied, skipped: outcome.skipped, errored: outcome.errored },
  });

  // Partial-success status, mirroring /import/commit: everything applied ⇒ 200; some ⇒ 207; nothing
  // applied on a real run ⇒ 422 (so a caller can't mistake a fully-skipped batch for success). A
  // dry-run always 200s — it's a projection, not an outcome.
  const status = dryRun || outcome.applied === outcome.total ? 200 : outcome.applied === 0 ? 422 : 207;
  res.status(status).json(outcome);
});

export default router;
