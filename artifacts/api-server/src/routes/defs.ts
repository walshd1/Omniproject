import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import { authorizeDefWrite, getDefScopePolicy, setDefScopePolicy, DEF_GATES } from "../lib/def-policy";
import {
  artifactStoreEnabled, makeScopedId, parseScopedId, scopeFromParsed, isStorageTarget, type StorageTarget,
} from "../lib/artifact-store";
import {
  sanitizeDef, sanitizeDefUpdate, validateDef, newStoredDef, updateStoredDef, storedDefMeta,
  listDefs, getDef, putDef, deleteDef, DefError, DEF_KINDS,
  type DefKind, type StoredDef, type StoredDefMeta,
} from "../lib/def-import";

/**
 * THE DEFINITION IMPORTER routes (roadmap X.3), behind the default-off `defImporter` module. The single
 * validated write-path for any user-defined JSON DEFINITION into the scoped encrypted stores. The author
 * chooses a storage target — `user` (their private area), `project`, or `org` — and the shared storage-target
 * gate decides who may write there (own area always; project by project scope; org by manager+). Read is
 * viewer+; author + delete are contributor+. Every write passes `sanitizeDef` (kind + name + the per-kind
 * validator) before the AES-256-GCM sealed store ever sees it. Definitions only — no executable code.
 *
 * (Distinct from `/api/import`, the TABULAR data importer.)
 */
const router = Router();

/** Per-target authorization for a def op (no broker dependency — the sidecar target is not offered). */
const authorizeTarget = (req: Request, res: Response, storage: StorageTarget, projectId: string | undefined, op: "read" | "write"): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, { capability: false, capabilityError: "the definition importer does not support the sidecar target" });

// POST /api/defs/validate — dry-run: validate a payload by kind without writing (contributor+).
router.post("/defs/validate", requireRole("contributor"), (req, res) => {
  const body = (req.body ?? {}) as { kind?: unknown; payload?: unknown };
  if (typeof body.kind !== "string" || !(DEF_KINDS as readonly string[]).includes(body.kind)) {
    res.status(400).json({ error: `kind must be one of ${DEF_KINDS.join(", ")}` });
    return;
  }
  const result = validateDef(body.kind as DefKind, body.payload);
  res.json({ valid: result.ok, errors: result.errors });
});

// GET /api/defs/policy — the per-scope write policy (viewer+ may read it; the UI shows what each scope needs).
router.get("/defs/policy", requireRole("viewer"), (_req, res) => {
  res.json({ policy: getDefScopePolicy(), gates: DEF_GATES });
});

// PUT /api/defs/policy — change who may write at each scope (admin only — altering the permission model).
router.put("/defs/policy", requireRole("admin"), (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const scope of ["user", "project", "org"] as const) {
    if (body[scope] !== undefined && !(DEF_GATES as readonly string[]).includes(String(body[scope]))) {
      res.status(400).json({ error: `${scope} gate must be one of ${DEF_GATES.join(", ")}` });
      return;
    }
  }
  res.json({ policy: setDefScopePolicy(body) });
});

// GET /api/defs?kind=&projectId= — the stored defs the caller can reach (payload omitted), aggregated across
// their private area, the org area, and the requested project's area (when in scope). viewer+.
router.get("/defs", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_defs failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const kind = typeof req.query["kind"] === "string" ? req.query["kind"] : undefined;
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const metas: StoredDefMeta[] = [];
    if (ctx.sub) for (const a of listDefs({ kind: "user", sub: ctx.sub })) metas.push(storedDefMeta(a));
    for (const a of listDefs({ kind: "org" })) metas.push(storedDefMeta(a));
    if (projectId && (await assertProjectScope(req, projectId)).ok) {
      for (const a of listDefs({ kind: "project", projectId })) metas.push(storedDefMeta(a));
    }
    res.json(kind ? metas.filter((m) => m.kind === kind) : metas);
  }),
);

// GET /api/defs/resolved/:kind — the stored defs of ONE kind WITH their payloads, aggregated across the
// caller's private area + the org area + the requested project (when in scope). viewer+. This is the read
// SEAM that renderers consume to render user-authored defs from the one importer store (roadmap X.10 — the
// two-store unification). Scope-filtered exactly like the metadata list; only the payload is included here.
// (Two path segments after /defs, so it never collides with the one-segment /defs/:id.)
router.get("/defs/resolved/:kind", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "resolve_defs failed", async () => {
    const kind = String(req.params["kind"]);
    if (!(DEF_KINDS as readonly string[]).includes(kind)) { res.status(400).json({ error: `kind must be one of ${DEF_KINDS.join(", ")}` }); return; }
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const rows: StoredDef[] = [];
    if (ctx.sub) for (const a of listDefs({ kind: "user", sub: ctx.sub })) rows.push(a);
    for (const a of listDefs({ kind: "org" })) rows.push(a);
    if (projectId && (await assertProjectScope(req, projectId)).ok) {
      for (const a of listDefs({ kind: "project", projectId })) rows.push(a);
    }
    res.json(rows.filter((r) => r.kind === kind));
  }),
);

// GET /api/defs/:id — one stored def with its payload (viewer+, subject to the target gate).
router.get("/defs/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_def failed", async () => {
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Not found" }); return; }
    const id = String(req.params["id"]);
    const parsed = parseScopedId(id);
    if (!parsed) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const ctx = contextFromReq(req);
    const scope = scopeFromParsed(parsed, ctx.sub);
    const item = scope ? getDef(scope, id) : null;
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    res.json(item);
  }),
);

// POST /api/defs — validate a user-defined JSON def and write it to the chosen scoped store (contributor+).
router.post("/defs", requireRole("contributor"), (req, res) => {
  const body = (req.body ?? {}) as { storage?: unknown; projectId?: unknown };
  if (!isStorageTarget(body.storage) || body.storage === "sidecar") { res.status(400).json({ error: "storage must be user, project or org" }); return; }
  const storage = body.storage;
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;

  let input;
  try { input = sanitizeDef(req.body); }
  catch (e) { if (e instanceof DefError) { res.status(400).json({ error: e.message }); return; } throw e; }

  return withBrokerErrors(req, res, "def import failed", async () => {
    if (!(await authorizeDefWrite(req, res, storage, projectId))) return;
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const ctx = contextFromReq(req);
    const id = makeScopedId(storage, crypto.randomUUID(), projectId);
    const scope = scopeFromParsed({ storage, ...(projectId ? { projectId } : {}) }, ctx.sub);
    if (!scope) { res.status(400).json({ error: "could not resolve a storage scope" }); return; }
    const row: StoredDef = newStoredDef(id, input, ctx, new Date().toISOString());
    putDef(scope, row);
    res.status(201).json(row);
  });
});

// PUT /api/defs/:id — edit an existing def in place (re-validated by its kind; write-gated by the policy at
// the def's own scope). The kind is fixed; the name + payload are replaced; rowVersion bumps.
router.put("/defs/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "update_def failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseScopedId(id);
    if (!parsed) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await authorizeDefWrite(req, res, parsed.storage, parsed.projectId))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = scopeFromParsed(parsed, ctx.sub);
    const existing = scope ? getDef(scope, id) : null;
    if (!existing || !scope) { res.status(404).json({ error: "Not found" }); return; }
    let upd;
    try { upd = sanitizeDefUpdate(existing.kind, req.body); }
    catch (e) { if (e instanceof DefError) { res.status(400).json({ error: e.message }); return; } throw e; }
    const row = updateStoredDef(existing, upd, new Date().toISOString());
    putDef(scope, row);
    res.json(row);
  }),
);

// DELETE /api/defs/:id — remove a stored def (contributor+, subject to the target gate).
router.delete("/defs/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "delete_def failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseScopedId(id);
    if (!parsed) { res.status(204).end(); return; }
    if (!(await authorizeDefWrite(req, res, parsed.storage, parsed.projectId))) return;
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const ctx = contextFromReq(req);
    const scope = scopeFromParsed(parsed, ctx.sub);
    if (scope) deleteDef(scope, id);
    res.status(204).end();
  }),
);

export default router;
