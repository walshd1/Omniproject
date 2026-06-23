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
import { isN8nConfigured, callN8n, authHeaderFromReq, N8nError } from "../lib/n8n";
import { getSettings, updateSettings } from "../lib/settings";

const router = Router();

function respondN8nError(res: Response, err: unknown): void {
  if (err instanceof N8nError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const isTimeout = err instanceof Error && err.name === "TimeoutError";
  res.status(502).json({ error: isTimeout ? "n8n request timed out" : "n8n unreachable" });
}

// ── Sample data (demo mode only — used when N8N_WEBHOOK_URL is not set) ────────

const SAMPLE_PROJECTS = [
  {
    id: "proj-001",
    name: "Platform Rewrite",
    identifier: "PLT",
    description: "Complete overhaul of the core platform infrastructure",
    source: "plane",
    issueCount: 24,
    completedCount: 9,
    memberCount: 5,
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "proj-002",
    name: "API Gateway v2",
    identifier: "AGW",
    description: "New unified API gateway with n8n orchestration",
    source: "plane",
    issueCount: 18,
    completedCount: 14,
    memberCount: 3,
    updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "proj-003",
    name: "Enterprise SSO",
    identifier: "SSO",
    description: "OIDC-based single sign-on across all services",
    source: "openproject",
    issueCount: 11,
    completedCount: 7,
    memberCount: 2,
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: "proj-004",
    name: "Monitoring Stack",
    identifier: "MON",
    description: "Observability infrastructure: metrics, traces, logs",
    source: "openproject",
    issueCount: 8,
    completedCount: 2,
    memberCount: 4,
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];

const SAMPLE_ISSUES: Record<string, Record<string, unknown>[]> = {
  "proj-001": [
    {
      id: "iss-001",
      projectId: "proj-001",
      title: "Migrate auth service to OIDC",
      description: "Replace legacy JWT flow with OIDC + Authentik",
      status: "in_progress",
      priority: "urgent",
      assignee: "alice",
      labels: ["auth", "infra"],
      startDate: "2026-06-10",
      dueDate: "2026-06-28",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    },
    {
      id: "iss-002",
      projectId: "proj-001",
      title: "Set up n8n webhook bidirectional flow",
      description: "Configure n8n to handle both inbound and outbound payloads",
      status: "todo",
      priority: "high",
      assignee: "bob",
      labels: ["n8n", "integration"],
      startDate: "2026-06-20",
      dueDate: "2026-07-05",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    },
    {
      id: "iss-003",
      projectId: "proj-001",
      title: "Docker compose standalone validation",
      description: "Verify all services in standalone mode start correctly",
      status: "in_review",
      priority: "medium",
      assignee: "alice",
      labels: ["devops", "docker"],
      startDate: null,
      dueDate: "2026-06-25",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    },
    {
      id: "iss-004",
      projectId: "proj-001",
      title: "Write K8s manifest for enterprise deployment",
      description: "ClusterIP services, ingress, configmaps for OIDC vars",
      status: "backlog",
      priority: "medium",
      assignee: null,
      labels: ["k8s", "devops"],
      startDate: null,
      dueDate: null,
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    },
    {
      id: "iss-005",
      projectId: "proj-001",
      title: "Frontend command palette keyboard navigation",
      description: "Cmd+K opens cmdk dialog with full action set",
      status: "done",
      priority: "high",
      assignee: "carol",
      labels: ["frontend", "ux"],
      startDate: "2026-06-01",
      dueDate: "2026-06-15",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    },
    {
      id: "iss-006",
      projectId: "proj-001",
      title: "Traefik routing labels for *.local domains",
      description: "Configure Traefik reverse proxy for local dev",
      status: "cancelled",
      priority: "low",
      assignee: null,
      labels: ["infra", "devops"],
      startDate: null,
      dueDate: null,
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    },
  ],
  "proj-002": [
    {
      id: "iss-007",
      projectId: "proj-002",
      title: "Rate limiting middleware",
      description: "Per-IP and per-token rate limiting on all routes",
      status: "done",
      priority: "high",
      assignee: "bob",
      labels: ["backend", "security"],
      startDate: "2026-05-20",
      dueDate: "2026-06-01",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 200).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    },
    {
      id: "iss-008",
      projectId: "proj-002",
      title: "OpenAPI spec for gateway endpoints",
      description: "Document all proxy routes in OpenAPI 3.1",
      status: "done",
      priority: "medium",
      assignee: "alice",
      labels: ["docs", "api"],
      startDate: "2026-06-01",
      dueDate: "2026-06-10",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 168).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    },
    {
      id: "iss-009",
      projectId: "proj-002",
      title: "Health check endpoint",
      description: "GET /healthz with uptime and dependency status",
      status: "in_progress",
      priority: "low",
      assignee: "carol",
      labels: ["backend"],
      startDate: "2026-06-15",
      dueDate: "2026-06-22",
      source: "plane",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    },
  ],
  "proj-003": [
    {
      id: "iss-010",
      projectId: "proj-003",
      title: "Authentik local IdP setup",
      description: "Bundle Authentik with redis + postgres in standalone compose",
      status: "done",
      priority: "urgent",
      assignee: "alice",
      labels: ["auth", "infra"],
      startDate: "2026-05-01",
      dueDate: "2026-05-20",
      source: "openproject",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    },
    {
      id: "iss-011",
      projectId: "proj-003",
      title: "OIDC token relay in API proxy",
      description: "Extract Bearer from session, attach to n8n requests",
      status: "in_progress",
      priority: "high",
      assignee: "bob",
      labels: ["auth", "backend"],
      startDate: "2026-06-10",
      dueDate: "2026-06-30",
      source: "openproject",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
  ],
  "proj-004": [
    {
      id: "iss-012",
      projectId: "proj-004",
      title: "Prometheus scrape configs",
      description: "Configure scrape targets for all services",
      status: "todo",
      priority: "medium",
      assignee: null,
      labels: ["monitoring", "infra"],
      startDate: null,
      dueDate: "2026-07-15",
      source: "openproject",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    },
  ],
};

let issueCounter = 100;

const SAMPLE_ACTIVITY = () => [
  {
    id: "act-001",
    action: "status_changed",
    actor: "alice",
    projectId: "proj-001",
    issueId: "iss-005",
    issueTitle: "Frontend command palette keyboard navigation",
    detail: "in_progress → done",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: "act-002",
    action: "issue_created",
    actor: "bob",
    projectId: "proj-001",
    issueId: "iss-004",
    issueTitle: "Write K8s manifest for enterprise deployment",
    detail: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: "act-003",
    action: "status_changed",
    actor: "carol",
    projectId: "proj-002",
    issueId: "iss-009",
    issueTitle: "Health check endpoint",
    detail: "todo → in_progress",
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "act-004",
    action: "priority_changed",
    actor: "alice",
    projectId: "proj-001",
    issueId: "iss-001",
    issueTitle: "Migrate auth service to OIDC",
    detail: "high → urgent",
    timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────
// When n8n is configured every data action is brokered through it; otherwise the
// gateway falls back to the sample data above so the app still runs locally.

router.get("/projects", async (req, res) => {
  const source = getSettings().backendSource;
  if (isN8nConfigured) {
    try {
      const result = await callN8n("list_projects", {}, { authHeader: authHeaderFromReq(req), source });
      res.json(result.data ?? []);
    } catch (err) {
      req.log.error({ err }, "list_projects via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }
  res.json(SAMPLE_PROJECTS);
});

router.get("/projects/:projectId/issues", async (req, res) => {
  const parse = GetProjectIssuesParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  const source = getSettings().backendSource;

  if (isN8nConfigured) {
    try {
      const result = await callN8n("list_issues", { projectId }, { authHeader: authHeaderFromReq(req), source });
      res.json(result.data ?? []);
    } catch (err) {
      req.log.error({ err, projectId }, "list_issues via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }
  res.json(SAMPLE_ISSUES[projectId] ?? []);
});

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
        { authHeader: authHeaderFromReq(req), source },
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
    source: getSettings().backendSource === "openproject" ? "openproject" : "plane",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!SAMPLE_ISSUES[projectId]) SAMPLE_ISSUES[projectId] = [];
  SAMPLE_ISSUES[projectId].push(issue);
  const proj = SAMPLE_PROJECTS.find((p) => p.id === projectId);
  if (proj) proj.issueCount += 1;
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
  const source = getSettings().backendSource;

  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "update_issue",
        { projectId, issueId, ...bodyParse.data },
        { authHeader: authHeaderFromReq(req), source },
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
  const source = getSettings().backendSource;

  if (isN8nConfigured) {
    try {
      await callN8n("delete_issue", { projectId, issueId }, { authHeader: authHeaderFromReq(req), source });
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
  if (proj && proj.issueCount > 0) proj.issueCount -= 1;
  res.status(204).send();
});

router.get("/projects/:projectId/summary", async (req, res) => {
  const parse = GetProjectSummaryParams.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const { projectId } = parse.data;
  const source = getSettings().backendSource;

  if (isN8nConfigured) {
    try {
      const result = await callN8n("project_summary", { projectId }, { authHeader: authHeaderFromReq(req), source });
      res.json(result.data);
    } catch (err) {
      req.log.error({ err, projectId }, "project_summary via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }

  const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{
    status: string;
    priority: string;
    dueDate: string | null;
  }>;
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let overdue = 0;
  const now = new Date();
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    byPriority[issue.priority] = (byPriority[issue.priority] ?? 0) + 1;
    if (issue.dueDate && new Date(issue.dueDate) < now && issue.status !== "done" && issue.status !== "cancelled") {
      overdue++;
    }
  }
  const total = issues.length;
  const done = byStatus["done"] ?? 0;
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
  res.json({ projectId, total, byStatus, byPriority, completionRate, overdue });
});

router.get("/activity", async (req, res) => {
  if (isN8nConfigured) {
    try {
      const result = await callN8n(
        "list_activity",
        {},
        { authHeader: authHeaderFromReq(req), source: getSettings().backendSource },
      );
      res.json(result.data ?? []);
    } catch (err) {
      req.log.error({ err }, "list_activity via n8n failed");
      respondN8nError(res, err);
    }
    return;
  }
  res.json(SAMPLE_ACTIVITY());
});

// ── Settings (gateway-local, never brokered through n8n) ──────────────────────

router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

router.patch("/settings", (req, res) => {
  res.json(updateSettings(req.body ?? {}));
});

export default router;
