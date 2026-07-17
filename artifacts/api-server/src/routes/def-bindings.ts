import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole, hasRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { recordRequestAudit } from "../lib/audit";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { getScopeBindings, setScopeBinding, loadBindingConfig, canRebind, type DefBinding } from "../lib/def-binding";

/**
 * DEF SELECTION BINDINGS routes (roadmap X.12). Records "for slot S at scope T, use def D (optionally locked)".
 * Scoping is the point: a `project` binding lives in THAT project's sealed scope and needs manager + that
 * project's scope, so a PM's change is confined to their project. `org` needs pmo/admin. `user` is a
 * contributor's own pick. A write is refused when a HIGHER scope has locked the slot (the org mandate wins).
 * Read is viewer+. Behind the default-off `defImporter` module (shares the def store's plumbing).
 */
const router = Router();

// GET /api/defs/bindings?projectId= — the org + (the caller's) project + (the caller's) user binding maps.
router.get("/defs/bindings", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_bindings failed", async () => {
    if (!artifactStoreEnabled()) { res.json({ org: {}, project: {}, user: {} }); return; }
    const ctx = contextFromReq(req);
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const inProject = !!projectId && (await assertProjectScope(req, projectId)).ok;
    res.json({
      org: getScopeBindings({ kind: "org" }),
      project: inProject ? getScopeBindings({ kind: "project", projectId: projectId! }) : {},
      user: ctx.sub ? getScopeBindings({ kind: "user", sub: ctx.sub }) : {},
    });
  }),
);

// PUT /api/defs/bindings — set (or clear) one slot's selection at a scope.
//   body: { scope: "user"|"project"|"org", slot, defId?|null, locked?, projectId? }
router.put("/defs/bindings", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "set_binding failed", async () => {
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const body = (req.body ?? {}) as { scope?: unknown; slot?: unknown; defId?: unknown; locked?: unknown; projectId?: unknown };
    const scope = body.scope;
    const slot = typeof body.slot === "string" ? body.slot.trim() : "";
    if (!slot) { res.status(400).json({ error: "slot is required" }); return; }
    if (scope !== "user" && scope !== "project" && scope !== "org") { res.status(400).json({ error: "scope must be user, project or org" }); return; }
    const clearing = body.defId === null || body.defId === undefined;
    const defId = typeof body.defId === "string" ? body.defId.trim() : "";
    if (!clearing && !defId) { res.status(400).json({ error: "defId must be a non-empty string (or null to clear)" }); return; }
    const wantLock = body.locked === true;
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    const ctx = contextFromReq(req);
    const cfgCtx = { ...(projectId ? { projectId } : {}), ...(ctx.sub ? { sub: ctx.sub } : {}) };
    const config = loadBindingConfig(cfgCtx);

    if (scope === "user") {
      if (!ctx.sub) { res.status(400).json({ error: "no user scope on this session" }); return; }
      if (!canRebind(config, slot, "user", cfgCtx)) { res.status(409).json({ error: "this selection is locked by a higher scope" }); return; }
      const bindings = setScopeBinding({ kind: "user", sub: ctx.sub }, slot, clearing ? null : { defId }); // a user never locks others
      recordRequestAudit(req, { category: "admin", action: "def_binding_user", write: true, meta: { slot } });
      res.json({ scope, bindings });
      return;
    }

    if (scope === "project") {
      if (!projectId) { res.status(400).json({ error: "projectId is required for a project binding" }); return; }
      if (!hasRole(req, "manager")) { res.status(403).json({ error: "a project selection needs manager" }); return; }
      if (!(await assertProjectScope(req, projectId)).ok) { res.status(403).json({ error: "out of scope for that project" }); return; }
      if (!canRebind(config, slot, "project", cfgCtx)) { res.status(409).json({ error: "this selection is locked org-wide" }); return; }
      const binding: DefBinding | null = clearing ? null : { defId, ...(wantLock ? { locked: true } : {}) };
      const bindings = setScopeBinding({ kind: "project", projectId }, slot, binding);
      recordRequestAudit(req, { category: "admin", action: "def_binding_project", write: true, projectId, meta: { slot, locked: wantLock } });
      res.json({ scope, projectId, bindings });
      return;
    }

    // org
    if (!(hasRole(req, "pmo") || hasRole(req, "admin"))) { res.status(403).json({ error: "an org selection needs pmo or admin" }); return; }
    const binding: DefBinding | null = clearing ? null : { defId, ...(wantLock ? { locked: true } : {}) };
    const bindings = setScopeBinding({ kind: "org" }, slot, binding);
    recordRequestAudit(req, { category: "admin", action: "def_binding_org", write: true, meta: { slot, locked: wantLock } });
    res.json({ scope, bindings });
  }),
);

export default router;
