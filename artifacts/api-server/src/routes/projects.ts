import { Router } from "express";
import {
  CreateIssueBody,
  CreateIssueParams,
  UpdateIssueBody,
  UpdateIssueParams,
  DeleteIssueParams,
  GetProjectSummaryParams,
  GetProjectIssuesParams,
} from "@workspace/api-zod";
import { getBroker, contextFromReq, respondBrokerError } from "../broker";
import { getSettings, updateSettings } from "../lib/settings";
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
import { captureVersion } from "../lib/config-store";
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

// ── Settings (gateway-local, never brokered to a backend) ─────────────────────

router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

// Settings change the gateway's wiring (broker URL, AI provider) — admin only.
// Each change is versioned so it can be rolled back (see config-store).
router.patch("/settings", requireRole("admin"), (req, res) => {
  const settings = updateSettings(req.body ?? {});
  captureVersion("settings updated");
  res.json(settings);
});

export default router;
