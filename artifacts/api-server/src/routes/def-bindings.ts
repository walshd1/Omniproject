import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole, hasRole, scopeForReq } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { inScope } from "../lib/scope";
import { stepUpFresh } from "../lib/step-up";
import { getSession } from "./auth";
import { recordRequestAudit } from "../lib/audit";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { getScopeBindings, setScopeBinding, loadBindingConfig, canRebind, type DefBinding } from "../lib/def-binding";

/**
 * DEF SELECTION BINDINGS routes (roadmap X.12). Records "for slot S at scope T, use def D (optionally locked)".
 * Scoping is the point: a `project` binding lives in THAT project's sealed scope and needs manager + that
 * project's scope; a `programme` binding needs **programmeManager+** and that PROGRAMME's scope (so a programme
 * manager's change is confined to their programme); `org` needs pmo/admin; `user` is a contributor's own pick.
 * A write is refused when a HIGHER scope has LOCKED the slot. **Setting a LOCK requires a fresh step-up** (a lock
 * overrides lower scopes — the mandate action), while everyday selection does not. Read is viewer+. Behind the
 * default-off `defImporter` module.
 */
const router = Router();

// GET /api/defs/bindings?projectId=&programmeId= — the org + (the caller's) programme + project + user maps.
router.get("/defs/bindings", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_bindings failed", async () => {
    if (!artifactStoreEnabled()) { res.json({ org: {}, programme: {}, project: {}, user: {} }); return; }
    const ctx = contextFromReq(req);
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const programmeId = typeof req.query["programmeId"] === "string" ? req.query["programmeId"] : undefined;
    const inProject = !!projectId && (await assertProjectScope(req, projectId)).ok;
    const inProgramme = !!programmeId && inScope(scopeForReq(req), { programmeIds: [programmeId] });
    res.json({
      org: getScopeBindings({ kind: "org" }),
      programme: inProgramme ? getScopeBindings({ kind: "programme", programmeId: programmeId! }) : {},
      project: inProject ? getScopeBindings({ kind: "project", projectId: projectId! }) : {},
      user: ctx.sub ? getScopeBindings({ kind: "user", sub: ctx.sub }) : {},
    });
  }),
);

// PUT /api/defs/bindings — set (or clear) one slot's selection at a scope.
//   body: { scope: "user"|"project"|"programme"|"org", slot, defId?|null, locked?, projectId?, programmeId? }
router.put("/defs/bindings", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "set_binding failed", async () => {
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const body = (req.body ?? {}) as { scope?: unknown; slot?: unknown; defId?: unknown; locked?: unknown; projectId?: unknown; programmeId?: unknown };
    const scope = body.scope;
    const slot = typeof body.slot === "string" ? body.slot.trim() : "";
    if (!slot) { res.status(400).json({ error: "slot is required" }); return; }
    if (scope !== "user" && scope !== "project" && scope !== "programme" && scope !== "org") { res.status(400).json({ error: "scope must be user, project, programme or org" }); return; }
    const clearing = body.defId === null || body.defId === undefined;
    const defId = typeof body.defId === "string" ? body.defId.trim() : "";
    if (!clearing && !defId) { res.status(400).json({ error: "defId must be a non-empty string (or null to clear)" }); return; }
    const wantLock = body.locked === true;
    // Setting a LOCK mandates lower scopes → require a fresh step-up (the everyday selection path does not).
    if (wantLock && !stepUpFresh(getSession(req), Date.now())) { res.status(403).json({ error: "setting a selection LOCK requires a fresh step-up" }); return; }
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    const programmeId = typeof body.programmeId === "string" ? body.programmeId : undefined;
    const ctx = contextFromReq(req);

    if (scope === "user") {
      if (!ctx.sub) { res.status(400).json({ error: "no user scope on this session" }); return; }
      const cfgCtx = { ...(ctx.sub ? { sub: ctx.sub } : {}) };
      if (!canRebind(loadBindingConfig(cfgCtx), slot, "user", cfgCtx)) { res.status(409).json({ error: "this selection is locked by a higher scope" }); return; }
      const bindings = setScopeBinding({ kind: "user", sub: ctx.sub }, slot, clearing ? null : { defId }); // a user never locks others
      recordRequestAudit(req, { category: "admin", action: "def_binding_user", write: true, meta: { slot } });
      res.json({ scope, bindings });
      return;
    }

    if (scope === "project") {
      if (!projectId) { res.status(400).json({ error: "projectId is required for a project binding" }); return; }
      if (!hasRole(req, "manager")) { res.status(403).json({ error: "a project selection needs manager" }); return; }
      if (!(await assertProjectScope(req, projectId)).ok) { res.status(403).json({ error: "out of scope for that project" }); return; }
      const cfgCtx = { projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) };
      if (!canRebind(loadBindingConfig(cfgCtx), slot, "project", cfgCtx)) { res.status(409).json({ error: "this selection is locked by a higher scope" }); return; }
      const binding: DefBinding | null = clearing ? null : { defId, ...(wantLock ? { locked: true } : {}) };
      const bindings = setScopeBinding({ kind: "project", projectId }, slot, binding);
      recordRequestAudit(req, { category: "admin", action: "def_binding_project", write: true, projectId, meta: { slot, locked: wantLock } });
      res.json({ scope, projectId, bindings });
      return;
    }

    if (scope === "programme") {
      if (!programmeId) { res.status(400).json({ error: "programmeId is required for a programme binding" }); return; }
      // A programme selection needs the programmeManager rung (pmo/admin sit above it) AND that programme's scope,
      // so a programme manager's change is confined to a programme they own.
      if (!hasRole(req, "programmeManager")) { res.status(403).json({ error: "a programme selection needs the programmeManager role" }); return; }
      if (!inScope(scopeForReq(req), { programmeIds: [programmeId] })) { res.status(403).json({ error: "out of scope for that programme" }); return; }
      const cfgCtx = { programmeId };
      if (!canRebind(loadBindingConfig(cfgCtx), slot, "programme", cfgCtx)) { res.status(409).json({ error: "this selection is locked org-wide" }); return; }
      const binding: DefBinding | null = clearing ? null : { defId, ...(wantLock ? { locked: true } : {}) };
      const bindings = setScopeBinding({ kind: "programme", programmeId }, slot, binding);
      recordRequestAudit(req, { category: "admin", action: "def_binding_programme", write: true, meta: { slot, programmeId, locked: wantLock } });
      res.json({ scope, programmeId, bindings });
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
