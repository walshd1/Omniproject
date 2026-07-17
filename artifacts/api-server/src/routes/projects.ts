/**
 * Project, programme-membership, issue + task-item endpoints — the core read/write
 * surface. Reads serve through the active broker; writes are RBAC-gated
 * (contributor+) and then pass the business ruleset (passesBusinessRules) before
 * the brokered write. Validation is the zod contract; this is the thin shell.
 */
import { Router } from "express";
import { envInt } from "../lib/env-config";
import {
  CreateIssueBody,
  CreateIssueParams,
  UpdateIssueBody,
  UpdateIssueParams,
  DeleteIssueParams,
  GetProjectSummaryParams,
  GetProjectIssuesParams,
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  ListTaskItemsParams,
  CreateTaskItemParams,
  CreateTaskItemBody,
  ListProjectMembersParams,
} from "@workspace/api-zod";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import { resolveCapabilities } from "../lib/capabilities";
import { validateEntityInput, type FieldDescriptor } from "../lib/field-registry";
import { getSettings, updateSettings } from "../lib/settings";
import { PROJECT_DISPOSITIONS, type ProjectDisposition } from "../lib/closed-projects";
import { getArchiveStore } from "../lib/archive/archive-store";
import { checkFieldValues, resolveFieldType } from "../lib/field-validation";
import { randomUUID } from "node:crypto";
import { aggregateResourcePool } from "../lib/resource-pool";
import { guardProjectScope } from "../lib/project-scope";
import { resolveWbsMapping } from "../lib/wbs-mapping-resolve";
import { applyWbsMapping, WbsMappingError } from "../lib/wbs-mapping";
import { getSidecarWbs, hasSidecarWbs, upsertSidecarWbsRow } from "../lib/wbs-sidecar";
import { planWbsWrite } from "../lib/wbs-write";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { resolveMapping } from "../lib/mapping-resolve";
import { projectMappingRows, planMappingWrite, resolveMappingTargets } from "../lib/mapping";
import { getSidecarRows, upsertSidecarRow } from "../lib/mapping-sidecar";
import { resolveLiveSuperset } from "../lib/capabilities";
import { deriveMappingValidation } from "../lib/superset";
import { poolMap } from "../lib/concurrency-pool";
import {
  type Row,
  getProjects,
  getIssues,
  getTasks,
  getActivity,
  getSummary,
  getHistory,
  getBaseline,
  getRaid,
  getNotifications,
  brokerChangeToken,
} from "../lib/data";
import { conditionalJson } from "../lib/conditional";
import { analyticsLimiter } from "../lib/rate-limit";
import { requireRole, requireAnyRole, roleForReq } from "../lib/rbac";
import { forgetProjectGuid, collectProjectReferences } from "../lib/project-forget";
import { getFxRates } from "../lib/currency";
import { evaluateRuleset } from "../lib/ruleset";
import { recordAudit } from "../lib/audit";
import { CreateRaidEntryBody } from "@workspace/api-zod";
import type { Request, Response } from "express";

const router = Router();

/** Concurrency bound for the /resources roster fan-out over every project (Theme A in
 *  docs/PERF-PATTERNS-REVIEW.md — was an unbounded `Promise.all` over all 200 projects).
 *  Tunable via RESOURCE_ROSTER_FANOUT_LIMIT for deployments that want more/less parallelism. */
const RESOURCE_ROSTER_FANOUT_LIMIT = envInt("RESOURCE_ROSTER_FANOUT_LIMIT", 10, { min: 1 });

/**
 * Apply the EXTRA business ruleset AFTER the hard gate (requireRole already ran).
 * Returns false + sends 422 on a hard block; true otherwise (attaching any warnings
 * as a header + audit). Restrict-only — it can never grant an action RBAC denied.
 */
function passesBusinessRules(req: Request, res: Response, action: string, projectId: string, payload?: Record<string, unknown>): boolean {
  const v = evaluateRuleset({ action, write: true, role: roleForReq(req), projectId, payload });
  if (!v.allow) {
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `rule_block:${v.blocked!.id}`, projectId, result: "error", status: 422 });
    res.status(422).json({ error: v.blocked!.message, rule: v.blocked!.id });
    return false;
  }
  if (v.warnings.length) {
    res.setHeader("X-OmniProject-Rule-Warnings", v.warnings.map((w) => w.id).join(","));
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `rule_warn:${v.warnings.map((w) => w.id).join(",")}`, projectId, result: "success", status: 200 });
  }
  return true;
}

/** Minimal structural view of a zod schema's `safeParse` — lets the path-param
 *  helper stay generic without a direct zod dependency (api-server gets zod only
 *  transitively via @workspace/api-zod). */
interface ParamSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

/**
 * Parse the route's path params (`:projectId`, and any sibling like `:issueId`)
 * through its zod contract. On the failure path — unreachable in practice, since
 * the params coerce to strings — it sends the same `400 { error: message }` the
 * handlers used to inline and returns null so the caller early-returns. On success
 * it returns the parsed params.
 */
function parseRouteParams<T>(schema: ParamSchema<T>, req: Request, res: Response, message: string): T | null {
  const parse = schema.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: message });
    return null;
  }
  return parse.data;
}

// ── Reads (served by the active broker — live backend or demo) ────────────────

router.get("/projects", (req, res) =>
  withBrokerErrors(req, res, "list_projects failed", async () => {
    // Default-live: closed (completed/archived/cancelled) projects are excluded unless the caller opts
    // in with ?includeClosed=1. Vary the ETag by the flag so the two result sets never share a cache.
    const includeClosed = ["1", "true", "yes"].includes(String(req.query["includeClosed"] ?? "").toLowerCase());
    const base = await brokerChangeToken(req, "projects");
    await conditionalJson(req, res, {
      token: base && includeClosed ? `${base}:all` : base,
      read: () => getProjects(req, { includeClosed }),
    });
  }),
);

router.get("/projects/:projectId/issues", (req, res) => {
  const params = parseRouteParams(GetProjectIssuesParams, req, res, "Invalid project id");
  if (!params) return;
  return withBrokerErrors(req, res, "list_issues failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    await conditionalJson(req, res, {
      token: await brokerChangeToken(req, `issues:${params.projectId}`),
      read: () => getIssues(req, params.projectId),
    });
  });
});

router.get("/projects/:projectId/summary", (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  return withBrokerErrors(req, res, "project_summary failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getSummary(req, params.projectId));
  });
});

router.get("/activity", (req, res) =>
  withBrokerErrors(req, res, "list_activity failed", async () => {
    res.json(await getActivity(req));
  }),
);

// ── Writes (served by the active broker — live backend or demo) ───────────────

/** Project-entity field model for create-time validation (required name + the
 *  programme reference). The SPA dialog mirrors these descriptors. */
const PROJECT_DESCRIPTORS: FieldDescriptor[] = [
  { key: "name", label: "Name", type: "string", required: true },
  { key: "programmeId", label: "Programme", type: "reference", references: "programme" },
];

/** Enforce the admin-configured field-validation rules over the fields PRESENT in a write body. Only
 *  rules whose field is in the body are considered, so a rule for a field this entity doesn't carry
 *  never blocks the write. Returns violation messages (empty ⇒ ok). */
function fieldRuleErrors(data: Record<string, unknown>): string[] {
  const settings = getSettings();
  const rules = (settings.fieldValidation ?? []).filter((r) => Object.prototype.hasOwnProperty.call(data, r.field));
  if (!rules.length) return [];
  return checkFieldValues(rules, data, (f) => resolveFieldType(f, settings.customFields));
}

router.post("/projects", requireRole("manager"), async (req, res) => {
  const bodyParse = CreateProjectBody.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const caps = await resolveCapabilities(req);
  if (!caps.entities["project"]?.store) {
    res.status(403).json({ error: "This backend can't create projects" });
    return;
  }
  const errors = validateEntityInput(bodyParse.data as Record<string, unknown>, PROJECT_DESCRIPTORS);
  if (errors.length) {
    res.status(400).json({ error: errors[0]!.message, errors }); // errors.length checked above
    return;
  }
  const ruleErrors = fieldRuleErrors(bodyParse.data as Record<string, unknown>);
  if (ruleErrors.length) {
    res.status(400).json({ error: ruleErrors[0], errors: ruleErrors });
    return;
  }
  await withBrokerErrors(req, res, "create_project failed", async () => {
    // Mint the backend-independent correlation GUID here (once, in the gateway) and pass it to the
    // backend to store + echo. It's server-minted, never from the client body — see Project.omniInstanceId.
    const project = await getBroker().createProject(contextFromReq(req), { ...bodyParse.data, omniInstanceId: randomUUID() });
    res.status(201).json(project);
  });
});

// GET /projects/:projectGuid/references — export everything OmniProject holds about a project GUID
// (closed record, programme memberships, relinks, retired status) so an admin can save it BEFORE
// deleting. No project data — only OmniProject's own references. Admin/PMO only.
router.get("/projects/:projectGuid/references", requireAnyRole("pmo", "admin"), (req, res) => {
  res.json(collectProjectReferences(String(req.params["projectGuid"])));
});

// DELETE /projects/:projectGuid/links — "delete" a project from OmniProject's point of view: FORGET its
// correlation GUID from every reference list (the closed-project index, programme memberships, GUID
// aliases). OmniProject holds no project data — it lives in the backend SOR or the self-managed archive —
// so nothing there is touched; only the references are unlinked. Admin/PMO only.
router.delete("/projects/:projectGuid/links", requireAnyRole("pmo", "admin"), (req, res) => {
  const guid = String(req.params["projectGuid"]);
  const result = forgetProjectGuid(guid);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "project_forget", result: "success", status: 200 });
  res.json(result);
});

// POST /projects/:projectGuid/close — record a project's closure with a data DISPOSITION (leave it in
// the current SOR, or migrate to the self-managed archive). Writes the closed-project index entry;
// closing STICKILY retires the GUID (the settings cross-rule) so it drops out of live reads and can't
// be silently reactivated. Admin/PMO only — the governance decision the summary calls for.
router.post("/projects/:projectGuid/close", requireAnyRole("pmo", "admin"), (req, res) => {
  const guid = String(req.params["projectGuid"]).trim();
  if (!guid) { res.status(400).json({ error: "project GUID required" }); return; }
  const body = (req.body ?? {}) as { disposition?: unknown; source?: unknown; note?: unknown };
  const disposition = String(body.disposition ?? "") as ProjectDisposition;
  if (!(PROJECT_DISPOSITIONS as readonly string[]).includes(disposition)) {
    res.status(400).json({ error: `disposition must be one of: ${PROJECT_DISPOSITIONS.join(", ")}` });
    return;
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const record = {
    disposition,
    ...(typeof body.source === "string" && body.source.trim() ? { source: body.source.trim() } : {}),
    closedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  void withBrokerErrors(req, res, "project_close failed", async () => {
    // For the `archive` disposition, MIGRATE the data first — capture a snapshot (the project row +
    // its issues, while still live) into the self-managed archive. If that fails, DON'T record the
    // closure: never claim a project is archived when its data wasn't actually captured.
    if (disposition === "archive") {
      const project = (await getProjects(req)).find((p) => String((p as Row)["omniInstanceId"] ?? "") === guid);
      // A project still present in the backend is snapshotted before the closure is recorded. If it's
      // no longer in the backend there is nothing to capture, so the closure is recorded as a
      // bookkeeping entry with no snapshot (unchanged behaviour) — that's distinct from a capture that
      // FAILED, which must not be silently treated as "no data".
      if (project) {
        const projectId = String((project as Row)["id"]);
        // NO `.catch(() => [])` here: a transient broker read error must ABORT the archive — the error
        // propagates to withBrokerErrors → failure response, and the recordAudit/res.json below never
        // run — instead of being swallowed into an EMPTY snapshot that we persist and then report as a
        // success (the contract above: never claim a project is archived when its data wasn't actually
        // captured). A genuinely empty project still archives fine: the reads succeed and return [].
        const [issues, tasks] = await Promise.all([
          getIssues(req, projectId),
          getTasks(req, { projectId }).then((t) => t as unknown as Row[]),
        ]);
        // Also archive OmniProject's own settings for the project (programme memberships, relinks, …),
        // so its configuration is preserved alongside its data.
        const settings = collectProjectReferences(guid);
        await getArchiveStore().save({ guid, archivedAt: record.closedAt, project: project as Row, issues, tasks, settings, note });
      }
    }
    // Merge into the registry; validatePatch's cross-rule retires the GUID on write.
    updateSettings({ closedProjects: { ...getSettings().closedProjects, [guid]: record } });
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `project_close:${disposition}`, result: "success", status: 200 });
    res.json({ guid, ...record });
  });
});

router.patch("/projects/:projectId", requireRole("manager"), async (req, res) => {
  const paramsParse = UpdateProjectParams.safeParse(req.params);
  const bodyParse = UpdateProjectBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const data = bodyParse.data;
  const caps = await resolveCapabilities(req);
  const settingProgramme = data.programmeId !== undefined;
  // Joining/leaving a programme is gated on the programme entity; other edits on project.
  if (settingProgramme && !caps.entities["programme"]?.store) {
    res.status(403).json({ error: "This backend can't store programme grouping" });
    return;
  }
  if (!settingProgramme && !caps.entities["project"]?.store) {
    res.status(403).json({ error: "This backend can't update projects" });
    return;
  }
  const ruleErrors = fieldRuleErrors(data as Record<string, unknown>);
  if (ruleErrors.length) {
    res.status(400).json({ error: ruleErrors[0], errors: ruleErrors });
    return;
  }
  await withBrokerErrors(req, res, "update_project failed", async () => {
    if (!(await guardProjectScope(req, res, paramsParse.data.projectId))) return;
    const updated = await getBroker().updateProject(contextFromReq(req), paramsParse.data.projectId, data);
    res.json(updated);
  });
});

router.get("/resources", async (req, res) => {
  const caps = await resolveCapabilities(req);
  if (!caps.entities["member"]?.surface) {
    res.json([]);
    return;
  }
  await withBrokerErrors(req, res, "list_resource_pool failed", async () => {
    const broker = getBroker();
    const ctx = contextFromReq(req);
    const projects = await broker.listProjects(ctx);
    const rosters = await poolMap(projects, RESOURCE_ROSTER_FANOUT_LIMIT, async (p) => ({
      projectId: p.id,
      members: await broker.projectMembers(ctx, p.id).catch(() => []),
    }));
    res.json(aggregateResourcePool(rosters));
  });
});

router.get("/projects/:projectId/members", async (req, res) => {
  const params = parseRouteParams(ListProjectMembersParams, req, res, "Invalid request");
  if (!params) return;
  // Degrade gracefully: a backend that can't surface members returns an empty
  // roster (the UI falls back to a free-text assignee).
  const caps = await resolveCapabilities(req);
  if (!caps.entities["member"]?.surface) {
    res.json([]);
    return;
  }
  await withBrokerErrors(req, res, "list_project_members failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getBroker().projectMembers(contextFromReq(req), params.projectId));
  });
});

// ── Task children: issues & notes raised against a task ───────────────────────

router.get("/projects/:projectId/issues/:issueId/items", async (req, res) => {
  const params = parseRouteParams(ListTaskItemsParams, req, res, "Invalid request");
  if (!params) return;
  await withBrokerErrors(req, res, "list_task_items failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getBroker().listTaskItems(contextFromReq(req), params.projectId, params.issueId));
  });
});

router.post("/projects/:projectId/issues/:issueId/items", requireRole("contributor"), async (req, res) => {
  const paramsParse = CreateTaskItemParams.safeParse(req.params);
  const bodyParse = CreateTaskItemBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { kind } = bodyParse.data;
  const caps = await resolveCapabilities(req);
  if (!caps.entities[kind]?.store) {
    res.status(403).json({ error: `This backend can't store ${kind}s against a task` });
    return;
  }
  await withBrokerErrors(req, res, "create_task_item failed", async () => {
    if (!(await guardProjectScope(req, res, paramsParse.data.projectId))) return;
    const item = await getBroker().createTaskItem(
      contextFromReq(req),
      paramsParse.data.projectId,
      paramsParse.data.issueId,
      bodyParse.data,
    );
    res.status(201).json(item);
  });
});

router.post("/projects/:projectId/issues", requireRole("contributor"), async (req, res) => {
  const paramsParse = CreateIssueParams.safeParse(req.params);
  const bodyParse = CreateIssueBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId } = paramsParse.data;
  const body = bodyParse.data;
  if (!passesBusinessRules(req, res, "create_issue", projectId, body)) return;

  await withBrokerErrors(req, res, "create_issue failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const issue = await getBroker().writeIssue(contextFromReq(req), "create", { projectId, ...body });
    res.status(201).json(issue);
  }, { projectId });
});

router.patch("/projects/:projectId/issues/:issueId", requireRole("contributor"), async (req, res) => {
  const paramsParse = UpdateIssueParams.safeParse(req.params);
  const bodyParse = UpdateIssueBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId, issueId } = paramsParse.data;
  if (!passesBusinessRules(req, res, "update_issue", projectId, bodyParse.data)) return;

  // expectedVersion drives optimistic concurrency: the broker rejects a stale
  // edit as a `conflict` (409) — the demo adapter checks locally, a live
  // adapter forwards it so the backend (e.g. OpenProject lockVersion) enforces it.
  await withBrokerErrors(req, res, "update_issue failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const updated = await getBroker().writeIssue(contextFromReq(req), "update", { projectId, issueId, ...bodyParse.data });
    // A null result means the backend had no such issue to update. Emitting
    // `200 null` would violate the Issue response schema the client expects, so
    // surface it as a 404 instead.
    if (updated == null) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json(updated);
  }, { projectId, issueId });
});

router.delete("/projects/:projectId/issues/:issueId", requireRole("contributor"), async (req, res) => {
  const params = parseRouteParams(DeleteIssueParams, req, res, "Invalid params");
  if (!params) return;
  const { projectId, issueId } = params;
  if (!passesBusinessRules(req, res, "delete_issue", projectId)) return;

  await withBrokerErrors(req, res, "delete_issue failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    await getBroker().writeIssue(contextFromReq(req), "delete", { projectId, issueId });
    res.status(204).send();
  }, { projectId, issueId });
});

// ── Analytics: capacity + financials (strict rate limit) ──────────────────────

router.get("/projects/:projectId/capacity", analyticsLimiter, async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  await withBrokerErrors(req, res, "get_resource_capacity failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    res.json(await getBroker().resourceCapacity(contextFromReq(req), projectId));
  }, { projectId });
});

router.get("/projects/:projectId/financials", analyticsLimiter, async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  await withBrokerErrors(req, res, "get_project_financials failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    res.json(await getBroker().projectFinancials(contextFromReq(req), projectId));
  }, { projectId });
});

// ── SAP / ERP read models (docs/SAP-CONNECTOR.md §4.6) — the WBS cost-structure tree + per-WBS financial
//    roll-up a "copy of a SAP screen" renders. READ-ONLY, brokered from the system of record (zero-at-rest);
//    a backend that doesn't front an ERP omits the broker method and these answer 501.
router.get("/projects/:projectId/wbs", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  await withBrokerErrors(req, res, "list_wbs failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const broker = getBroker();
    if (!broker.listWbsElements) { res.status(501).json({ error: "this backend does not expose an ERP project structure" }); return; }
    res.json(await broker.listWbsElements(contextFromReq(req), projectId));
  }, { projectId });
});

// The WBS cost tree JOINED with each element's financials, shaped as `{ rows }` so the GENERIC table panel
// renders it from a JSON screen def (no bespoke component). This is what a "copy of a SAP screen" binds to.
// Two sources behind the ONE shape: when the project has AUTHORED sidecar WBS (the all-in-one / SAP-light case),
// the resolved mapping projects the sealed sidecar rows; otherwise the external broker's native WBS read models
// serve it. Either way the same `{ rows }` come out — the screen never knows where the data lives.
router.get("/projects/:projectId/wbs/cost-rows", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  await withBrokerErrors(req, res, "wbs_cost_rows failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const ctx = contextFromReq(req);

    // Sidecar-backed (our zero-at-rest store): resolve the mapping and project the sealed rows through it. The
    // sealed rows ARE the mapping's home bucket (the shipped core declares the built-in + sidecar home).
    if (hasSidecarWbs(projectId)) {
      const mapping = resolveWbsMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) });
      const { wbs, financials } = applyWbsMapping(getSidecarWbs(projectId), mapping, projectId);
      const rows = wbs.map((w) => {
        const f = financials[w.id];
        return { wbs: w.id, name: w.name, status: w.status ?? "", budget: f?.budget ?? null, actual: f?.actual ?? null, committed: f?.commitment ?? null, available: f?.available ?? null };
      });
      res.json({ rows });
      return;
    }

    // External backend that speaks WBS natively (the demo/ERP broker): use its read models directly.
    const broker = getBroker();
    if (!broker.listWbsElements) { res.status(501).json({ error: "this backend does not expose an ERP project structure" }); return; }
    const wbs = await broker.listWbsElements(ctx, projectId);
    const rows = await Promise.all(wbs.map(async (w) => {
      const f = broker.getWbsFinancials ? await broker.getWbsFinancials(ctx, w.id) : null;
      return { wbs: w.id, name: w.name, status: w.status ?? "", budget: f?.budget ?? null, actual: f?.actual ?? null, committed: f?.commitment ?? null, available: f?.available ?? null };
    }));
    res.json({ rows });
  }, { projectId });
});

// The EFFECTIVE WBS field mapping for this caller + project — the first-class Mapping resolved across
// system(core) → org fieldRouting → org → programme → project → user (nearest wins), adapted to the WBS view.
// This is what tells the cost screen which (broker, backend, field) feeds each semantic column; the admin UI
// reads it to show "where each field comes from", and it's the mapping the (slice B) dispatch will apply.
router.get("/projects/:projectId/wbs/mapping", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  await withBrokerErrors(req, res, "wbs_mapping failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const ctx = contextFromReq(req);
    try {
      res.json(resolveWbsMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) }));
    } catch (e) {
      if (e instanceof WbsMappingError) { res.status(404).json({ error: e.message }); return; }
      throw e;
    }
  }, { projectId });
});

// Write a WBS element's semantic field values back to their mapped homes (roadmap §4.6 — "data entered in a
// SAP-like interface … some fields map to OpenProject and some to our sidecar"). The resolved mapping routes
// each field: sidecar-targeted fields are written to our sealed store (created on first save, merged after);
// external-targeted fields are reported as `external` (broker write adapters are a later slice — never silently
// dropped). contributor+, project-scope gated, audited.
router.put("/projects/:projectId/wbs/:wbsId", requireRole("contributor"), async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  const wbsId = String(req.params["wbsId"] ?? "");
  await withBrokerErrors(req, res, "wbs_write failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    if (!wbsId) { res.status(400).json({ error: "a WBS id is required" }); return; }
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const body = (req.body ?? {}) as { fields?: unknown };
    const values = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : null;
    if (!values) { res.status(400).json({ error: "fields must be an object of semanticKey → value" }); return; }
    const ctx = contextFromReq(req);
    let mapping;
    try { mapping = resolveWbsMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) }); }
    catch (e) { if (e instanceof WbsMappingError) { res.status(404).json({ error: e.message }); return; } throw e; }
    const plan = planWbsWrite(mapping, values);
    upsertSidecarWbsRow(projectId, plan.sidecarIdField, wbsId, plan.sidecar);
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `wbs_write:${wbsId}`, projectId, result: "success", status: 200 });
    res.json({
      wbsId,
      written: Object.keys(plan.sidecar),
      external: plan.external.map((e) => ({ key: e.key, broker: e.target.broker, backend: e.target.backend })),
      homeless: plan.homeless,
      unmapped: plan.unmapped,
    });
  }, { projectId });
});

router.get("/projects/:projectId/wbs/:wbsId/financials", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  const wbsId = String(req.params["wbsId"] ?? "");
  await withBrokerErrors(req, res, "get_wbs_financials failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const broker = getBroker();
    if (!broker.getWbsFinancials) { res.status(501).json({ error: "this backend does not expose ERP financials" }); return; }
    const fin = await broker.getWbsFinancials(contextFromReq(req), wbsId);
    if (!fin) { res.status(404).json({ error: "no financials for that WBS element" }); return; }
    res.json(fin);
  }, { projectId });
});

// ── Generic mapping surface (roadmap §4.6, "across the board") — the SAME (broker, backend) addressing +
//    sidecar the WBS cost screen uses, exposed for ANY slot so a form / report / custom screen JSON can bind a
//    mapped, sidecar-backed table with no bespoke code. WBS keeps its own richer endpoints (financial roll-ups).

// GET /projects/:projectId/mapping/:slot — the effective generic mapping for a slot (admin UI: "where each field
// comes from"). 404 when no scope authored that slot.
router.get("/projects/:projectId/mapping/:slot", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  const slot = String(req.params["slot"] ?? "");
  await withBrokerErrors(req, res, "get_mapping failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const ctx = contextFromReq(req);
    const mapping = resolveMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) }, slot);
    if (!mapping) { res.status(404).json({ error: `no mapping for slot "${slot}"` }); return; }
    // Surface homeless fields + the validation each UI field inherits from its live home, so the admin sees
    // both which fields need a home and what each one will accept.
    const { rules } = deriveMappingValidation(mapping.fields, await resolveLiveSuperset(req));
    res.json({ ...mapping, homeless: resolveMappingTargets(mapping).homeless, validation: rules });
  }, { projectId });
});

// GET /projects/:projectId/mapping/:slot/rows — the sidecar rows for a slot projected through the resolved
// mapping into `{ rows }` (the generic table shape). Empty rows when nothing authored; 404 when no mapping.
router.get("/projects/:projectId/mapping/:slot/rows", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  const slot = String(req.params["slot"] ?? "");
  await withBrokerErrors(req, res, "mapping_rows failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const ctx = contextFromReq(req);
    const mapping = resolveMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) }, slot);
    if (!mapping) { res.status(404).json({ error: `no mapping for slot "${slot}"` }); return; }
    res.json({ rows: projectMappingRows(getSidecarRows(projectId, slot), mapping) });
  }, { projectId });
});

// PUT /projects/:projectId/mapping/:slot/:rowId — write semantic field values for a row through the mapping:
// sidecar-targeted fields written to our sealed store, external-targeted fields reported (no adapter yet).
router.put("/projects/:projectId/mapping/:slot/:rowId", requireRole("contributor"), async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  const { projectId } = params;
  const slot = String(req.params["slot"] ?? "");
  const rowId = String(req.params["rowId"] ?? "");
  await withBrokerErrors(req, res, "mapping_write failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    if (!rowId) { res.status(400).json({ error: "a row id is required" }); return; }
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const body = (req.body ?? {}) as { fields?: unknown };
    const values = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : null;
    if (!values) { res.status(400).json({ error: "fields must be an object of semanticKey → value" }); return; }
    const ctx = contextFromReq(req);
    const mapping = resolveMapping({ projectId, ...(ctx.sub ? { sub: ctx.sub } : {}) }, slot);
    if (!mapping) { res.status(404).json({ error: `no mapping for slot "${slot}"` }); return; }
    // Enforce the validation each UI field inherits from its live home — a write can't violate what the
    // backend accepts (length/required/enum), the runtime half of "set the UI field to match the backend".
    const { rules, typeByUi } = deriveMappingValidation(mapping.fields, await resolveLiveSuperset(req));
    const violations = checkFieldValues(rules, values, (f) => typeByUi[f] ?? "string");
    if (violations.length) { res.status(400).json({ error: "field validation failed", violations }); return; }
    const plan = planMappingWrite(mapping, values);
    upsertSidecarRow(projectId, slot, plan.sidecarIdField, rowId, plan.sidecar);
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `mapping_write:${slot}:${rowId}`, projectId, result: "success", status: 200 });
    res.json({
      rowId,
      written: Object.keys(plan.sidecar),
      external: plan.external.map((e) => ({ key: e.key, broker: e.target.broker, backend: e.target.backend })),
      homeless: plan.homeless,
      unmapped: plan.unmapped,
    });
  }, { projectId });
});

// ── History + baseline (sourced from the system of record via the broker) ─────

router.get("/projects/:projectId/history", analyticsLimiter, async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  await withBrokerErrors(req, res, "get_project_history failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getHistory(req, params.projectId));
  }, { projectId: params.projectId });
});

router.get("/projects/:projectId/baseline", analyticsLimiter, async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  await withBrokerErrors(req, res, "get_baseline failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getBaseline(req, params.projectId));
  }, { projectId: params.projectId });
});

// ── RAID log ──────────────────────────────────────────────────────────────────

router.get("/projects/:projectId/raid", async (req, res) => {
  const params = parseRouteParams(GetProjectSummaryParams, req, res, "Invalid project id");
  if (!params) return;
  await withBrokerErrors(req, res, "get_raid failed", async () => {
    if (!(await guardProjectScope(req, res, params.projectId))) return;
    res.json(await getRaid(req, params.projectId));
  }, { projectId: params.projectId });
});

// RAID is a manager capability per the RBAC model (rbac.ts: "manager — contributor + RAID,
// baselines, portfolio actions"), and this route has no compensating ruleset gate — so gate at manager.
router.post("/projects/:projectId/raid", requireRole("manager"), async (req, res) => {
  const paramsParse = GetProjectSummaryParams.safeParse(req.params);
  const bodyParse = CreateRaidEntryBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId } = paramsParse.data;

  await withBrokerErrors(req, res, "create_raid_entry failed", async () => {
    if (!(await guardProjectScope(req, res, projectId))) return;
    const entry = await getBroker().addRaid(contextFromReq(req), projectId, bodyParse.data as Record<string, unknown>);
    res.status(201).json(entry);
  }, { projectId });
});

// ── Multi-currency FX rates (read-through; demo fallback) ─────────────────────

router.get("/fx-rates", (req, res) =>
  withBrokerErrors(req, res, "get_fx_rates failed", async () => {
    // Optional `asOf` (ISO date): the FX rate-source + as-of-date policy for consolidation
    // (period-close / budget rate). A broker that can't serve history degrades to spot.
    const asOf = typeof req.query["asOf"] === "string" ? req.query["asOf"] : undefined;
    res.json(await getFxRates(req, asOf));
  }),
);

// ── Notifications ─────────────────────────────────────────────────────────────

router.get("/notifications", (req, res) =>
  withBrokerErrors(req, res, "get_notifications failed", async () => {
    res.json(await getNotifications(req));
  }),
);

export default router;
