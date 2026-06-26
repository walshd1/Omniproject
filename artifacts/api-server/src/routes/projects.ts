import { Router } from "express";
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
import { getBroker, contextFromReq, respondBrokerError } from "../broker";
import { resolveCapabilities } from "../lib/capabilities";
import { validateEntityInput, type FieldDescriptor } from "../lib/field-registry";
import { aggregateResourcePool } from "../lib/resource-pool";
import {
  getProjects,
  getIssues,
  getActivity,
  getSummary,
  getHistory,
  getBaseline,
  getRaid,
  getNotifications,
} from "../lib/data";
import { analyticsLimiter } from "../lib/rate-limit";
import { requireRole } from "../lib/rbac";
import { getFxRates } from "../lib/currency";
import { CreateRaidEntryBody } from "@workspace/api-zod";

const router = Router();

// ── Reads (served by the active broker — live backend or demo) ────────────────

router.get("/projects", async (req, res) => {
  try {
    res.json(await getProjects(req));
  } catch (err) {
    req.log.error({ err }, "list_projects failed");
    respondBrokerError(res, err);
  }
});

router.get("/projects/:projectId/issues", async (req, res) => {
  const parse = GetProjectIssuesParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    res.json(await getIssues(req, parse.data.projectId));
  } catch (err) {
    req.log.error({ err }, "list_issues failed");
    respondBrokerError(res, err);
  }
});

router.get("/projects/:projectId/summary", async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    res.json(await getSummary(req, parse.data.projectId));
  } catch (err) {
    req.log.error({ err }, "project_summary failed");
    respondBrokerError(res, err);
  }
});

router.get("/activity", async (req, res) => {
  try {
    res.json(await getActivity(req));
  } catch (err) {
    req.log.error({ err }, "list_activity failed");
    respondBrokerError(res, err);
  }
});

// ── Writes (served by the active broker — live backend or demo) ───────────────

/** Project-entity field model for create-time validation (required name + the
 *  programme reference). The SPA dialog mirrors these descriptors. */
const PROJECT_DESCRIPTORS: FieldDescriptor[] = [
  { key: "name", label: "Name", type: "string", required: true },
  { key: "programmeId", label: "Programme", type: "reference", references: "programme" },
];

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
    res.status(400).json({ error: errors[0].message, errors });
    return;
  }
  try {
    const project = await getBroker().createProject(contextFromReq(req), bodyParse.data);
    res.status(201).json(project);
  } catch (err) {
    req.log.error({ err }, "create_project failed");
    respondBrokerError(res, err);
  }
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
  try {
    const updated = await getBroker().updateProject(contextFromReq(req), paramsParse.data.projectId, data);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "update_project failed");
    respondBrokerError(res, err);
  }
});

router.get("/resources", async (req, res) => {
  const caps = await resolveCapabilities(req);
  if (!caps.entities["member"]?.surface) {
    res.json([]);
    return;
  }
  try {
    const broker = getBroker();
    const ctx = contextFromReq(req);
    const projects = await broker.listProjects(ctx);
    const rosters = await Promise.all(
      projects.map(async (p) => ({ projectId: p.id, members: await broker.projectMembers(ctx, p.id).catch(() => []) })),
    );
    res.json(aggregateResourcePool(rosters));
  } catch (err) {
    req.log.error({ err }, "list_resource_pool failed");
    respondBrokerError(res, err);
  }
});

router.get("/projects/:projectId/members", async (req, res) => {
  const parse = ListProjectMembersParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  // Degrade gracefully: a backend that can't surface members returns an empty
  // roster (the UI falls back to a free-text assignee).
  const caps = await resolveCapabilities(req);
  if (!caps.entities["member"]?.surface) {
    res.json([]);
    return;
  }
  try {
    res.json(await getBroker().projectMembers(contextFromReq(req), parse.data.projectId));
  } catch (err) {
    req.log.error({ err }, "list_project_members failed");
    respondBrokerError(res, err);
  }
});

// ── Task children: issues & notes raised against a task ───────────────────────

router.get("/projects/:projectId/issues/:issueId/items", async (req, res) => {
  const parse = ListTaskItemsParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await getBroker().listTaskItems(contextFromReq(req), parse.data.projectId, parse.data.issueId));
  } catch (err) {
    req.log.error({ err }, "list_task_items failed");
    respondBrokerError(res, err);
  }
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
  try {
    const item = await getBroker().createTaskItem(
      contextFromReq(req),
      paramsParse.data.projectId,
      paramsParse.data.issueId,
      bodyParse.data,
    );
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "create_task_item failed");
    respondBrokerError(res, err);
  }
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

  try {
    const issue = await getBroker().writeIssue(contextFromReq(req), "create", { projectId, ...body });
    res.status(201).json(issue);
  } catch (err) {
    req.log.error({ err, projectId }, "create_issue failed");
    respondBrokerError(res, err);
  }
});

router.patch("/projects/:projectId/issues/:issueId", requireRole("contributor"), async (req, res) => {
  const paramsParse = UpdateIssueParams.safeParse(req.params);
  const bodyParse = UpdateIssueBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId, issueId } = paramsParse.data;

  // expectedVersion drives optimistic concurrency: the broker rejects a stale
  // edit as a `conflict` (409) — the demo adapter checks locally, a live
  // adapter forwards it so the backend (e.g. OpenProject lockVersion) enforces it.
  try {
    const updated = await getBroker().writeIssue(contextFromReq(req), "update", { projectId, issueId, ...bodyParse.data });
    // A null result means the backend had no such issue to update. Emitting
    // `200 null` would violate the Issue response schema the client expects, so
    // surface it as a 404 instead.
    if (updated == null) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err, projectId, issueId }, "update_issue failed");
    respondBrokerError(res, err);
  }
});

router.delete("/projects/:projectId/issues/:issueId", requireRole("contributor"), async (req, res) => {
  const paramsParse = DeleteIssueParams.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const { projectId, issueId } = paramsParse.data;

  try {
    await getBroker().writeIssue(contextFromReq(req), "delete", { projectId, issueId });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err, projectId, issueId }, "delete_issue failed");
    respondBrokerError(res, err);
  }
});

// ── Analytics: capacity + financials (strict rate limit) ──────────────────────

router.get("/projects/:projectId/capacity", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  try {
    res.json(await getBroker().resourceCapacity(contextFromReq(req), projectId));
  } catch (err) {
    req.log.error({ err, projectId }, "get_resource_capacity failed");
    respondBrokerError(res, err);
  }
});

router.get("/projects/:projectId/financials", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  try {
    res.json(await getBroker().projectFinancials(contextFromReq(req), projectId));
  } catch (err) {
    req.log.error({ err, projectId }, "get_project_financials failed");
    respondBrokerError(res, err);
  }
});

// ── History + baseline (sourced from the system of record via the broker) ─────

router.get("/projects/:projectId/history", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    res.json(await getHistory(req, parse.data.projectId));
  } catch (err) {
    req.log.error({ err, projectId: parse.data.projectId }, "get_project_history failed");
    respondBrokerError(res, err);
  }
});

router.get("/projects/:projectId/baseline", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    res.json(await getBaseline(req, parse.data.projectId));
  } catch (err) {
    req.log.error({ err, projectId: parse.data.projectId }, "get_baseline failed");
    respondBrokerError(res, err);
  }
});

// ── RAID log ──────────────────────────────────────────────────────────────────

router.get("/projects/:projectId/raid", async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    res.json(await getRaid(req, parse.data.projectId));
  } catch (err) {
    req.log.error({ err, projectId: parse.data.projectId }, "get_raid failed");
    respondBrokerError(res, err);
  }
});

router.post("/projects/:projectId/raid", requireRole("contributor"), async (req, res) => {
  const paramsParse = GetProjectSummaryParams.safeParse(req.params);
  const bodyParse = CreateRaidEntryBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId } = paramsParse.data;

  try {
    const entry = await getBroker().addRaid(contextFromReq(req), projectId, bodyParse.data as Record<string, unknown>);
    res.status(201).json(entry);
  } catch (err) {
    req.log.error({ err, projectId }, "create_raid_entry failed");
    respondBrokerError(res, err);
  }
});

// ── Multi-currency FX rates (read-through; demo fallback) ─────────────────────

router.get("/fx-rates", async (req, res) => {
  try {
    res.json(await getFxRates(req));
  } catch (err) {
    req.log.error({ err }, "get_fx_rates failed");
    respondBrokerError(res, err);
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

router.get("/notifications", async (req, res) => {
  try {
    res.json(await getNotifications(req));
  } catch (err) {
    req.log.error({ err }, "get_notifications failed");
    respondBrokerError(res, err);
  }
});

export default router;
