import { Router, type Response } from "express";
import {
  CreateIssueBody,
  CreateIssueParams,
  UpdateIssueBody,
  UpdateIssueParams,
  DeleteIssueParams,
  GetProjectSummaryParams,
  GetProjectIssuesParams,
} from "@workspace/api-zod";
import { isN8nConfigured, callN8n, authHeaderFromReq, userContextFromReq, N8nError } from "../lib/n8n";
import { getSettings, updateSettings } from "../lib/settings";
import {
  getProjects,
  getIssues,
  getActivity,
  getSummary,
  SAMPLE_PROJECTS,
  SAMPLE_ISSUES,
} from "../lib/data";
import { analyticsLimiter } from "../lib/rate-limit";

const router = Router();

function respondN8nError(res: Response, err: unknown): void {
  if (err instanceof N8nError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const isTimeout = err instanceof Error && err.name === "TimeoutError";
  res.status(502).json({ error: isTimeout ? "n8n request timed out" : "n8n unreachable" });
}

let issueCounter = 100;

// ── Reads (brokered through n8n when configured, else sample data) ────────────

router.get("/projects", async (req, res) => {
  try {
    res.json(await getProjects(req));
  } catch (err) {
    req.log.error({ err }, "list_projects failed");
    respondN8nError(res, err);
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
    respondN8nError(res, err);
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
    respondN8nError(res, err);
  }
});

router.get("/activity", async (req, res) => {
  try {
    res.json(await getActivity(req));
  } catch (err) {
    req.log.error({ err }, "list_activity failed");
    respondN8nError(res, err);
  }
});

// ── Writes (brokered through n8n when configured, else mutate sample data) ────

router.post("/projects/:projectId/issues", async (req, res) => {
  const paramsParse = CreateIssueParams.safeParse(req.params);
  const bodyParse = CreateIssueBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId } = paramsParse.data;
  const body = bodyParse.data;
  const source = getSettings().backendSource;

  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "create_issue",
        { projectId, ...body },
        { authHeader: authHeaderFromReq(req), source, userContext: userContextFromReq(req) },
      );
      res.status(201).json(result.data);
    } catch (err) {
      req.log.error({ err, projectId }, "create_issue via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }

  const issue = {
    id: `iss-${++issueCounter}`,
    projectId,
    title: body.title,
    description: body.description ?? null,
    status: body.status ?? "backlog",
    priority: body.priority ?? "none",
    assignee: body.assignee ?? null,
    labels: body.labels ?? [],
    startDate: body.startDate ?? null,
    dueDate: body.dueDate ?? null,
    source: source === "openproject" ? "openproject" : "plane",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!SAMPLE_ISSUES[projectId]) SAMPLE_ISSUES[projectId] = [];
  SAMPLE_ISSUES[projectId].push(issue);
  const proj = SAMPLE_PROJECTS.find((p) => p.id === projectId);
  if (proj) proj.issueCount = (proj.issueCount as number) + 1;
  res.status(201).json(issue);
});

router.patch("/projects/:projectId/issues/:issueId", async (req, res) => {
  const paramsParse = UpdateIssueParams.safeParse(req.params);
  const bodyParse = UpdateIssueBody.safeParse(req.body);
  if (!paramsParse.success || !bodyParse.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { projectId, issueId } = paramsParse.data;

  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "update_issue",
        { projectId, issueId, ...bodyParse.data },
        { authHeader: authHeaderFromReq(req), source: getSettings().backendSource, userContext: userContextFromReq(req) },
      );
      res.json(result.data);
    } catch (err) {
      req.log.error({ err, projectId, issueId }, "update_issue via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }

  const issues = SAMPLE_ISSUES[projectId];
  if (!issues) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const idx = issues.findIndex((i) => (i as { id: string }).id === issueId);
  if (idx === -1) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  const updated = { ...issues[idx], ...bodyParse.data, updatedAt: new Date().toISOString() };
  issues[idx] = updated;
  res.json(updated);
});

router.delete("/projects/:projectId/issues/:issueId", async (req, res) => {
  const paramsParse = DeleteIssueParams.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const { projectId, issueId } = paramsParse.data;

  if (isN8nConfigured) {
    try {
      await callN8n("delete_issue", { projectId, issueId }, { authHeader: authHeaderFromReq(req), source: getSettings().backendSource, userContext: userContextFromReq(req) });
      res.status(204).send();
    } catch (err) {
      req.log.error({ err, projectId, issueId }, "delete_issue via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }

  const issues = SAMPLE_ISSUES[projectId];
  if (!issues) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const idx = issues.findIndex((i) => (i as { id: string }).id === issueId);
  if (idx !== -1) issues.splice(idx, 1);
  const proj = SAMPLE_PROJECTS.find((p) => p.id === projectId);
  if (proj && (proj.issueCount as number) > 0) proj.issueCount = (proj.issueCount as number) - 1;
  res.status(204).send();
});

// ── Analytics: capacity + financials (strict rate limit) ──────────────────────

const SAMPLE_CAPACITY = [
  { resourceId: "u-alice", resourceName: "Alice Tan", role: "Senior DevOps", allocationPercentage: 120, assignedHours: 48, availableHours: 40, utilizationState: "OVER_ALLOCATED" },
  { resourceId: "u-bob", resourceName: "Bob Reyes", role: "Backend Engineer", allocationPercentage: 95, assignedHours: 38, availableHours: 40, utilizationState: "OPTIMAL" },
  { resourceId: "u-carol", resourceName: "Carol Singh", role: "Frontend Engineer", allocationPercentage: 60, assignedHours: 24, availableHours: 40, utilizationState: "UNDER_ALLOCATED" },
  { resourceId: "u-dan", resourceName: "Dan Whitfield", role: "QA Lead", allocationPercentage: 105, assignedHours: 42, availableHours: 40, utilizationState: "OVER_ALLOCATED" },
];

const SAMPLE_FINANCIALS = {
  currency: "GBP",
  budgetAllocated: 480000,
  actualBurn: 312000,
  earnedValue: 288000,
  cpi: 0.92,
  spi: 0.88,
  financialHealth: "AMBER",
  forecastCostAtCompletion: 521739,
};

router.get("/projects/:projectId/capacity", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "get_resource_capacity",
        { projectId },
        { authHeader: authHeaderFromReq(req), source: "capacity_engine", userContext: userContextFromReq(req) },
      );
      res.json(result.data ?? []);
    } catch (err) {
      req.log.error({ err, projectId }, "get_resource_capacity via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }
  res.json(SAMPLE_CAPACITY);
});

router.get("/projects/:projectId/financials", analyticsLimiter, async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "get_project_financials",
        { projectId },
        { authHeader: authHeaderFromReq(req), source: "financial_ledger", userContext: userContextFromReq(req) },
      );
      res.json(result.data ?? {});
    } catch (err) {
      req.log.error({ err, projectId }, "get_project_financials via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }
  res.json(SAMPLE_FINANCIALS);
});

// ── Settings (gateway-local, never brokered through n8n) ──────────────────────

router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

router.patch("/settings", (req, res) => {
  res.json(updateSettings(req.body ?? {}));
});

export default router;
