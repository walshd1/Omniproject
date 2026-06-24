import type { Request } from "express";
import { isN8nConfigured, callN8n, authHeaderFromReq } from "./n8n";
import { getSettings } from "./settings";

/**
 * Single read accessor for project data, shared by the API routes and the
 * exporter. When n8n is configured every read is brokered through it; otherwise
 * the sample data below is served so the app still runs in demo mode.
 */

export type Row = Record<string, unknown>;

export const SAMPLE_PROJECTS: Row[] = [
  { id: "proj-001", name: "Platform Rewrite", identifier: "PLT", description: "Complete overhaul of the core platform infrastructure", source: "plane", issueCount: 24, completedCount: 9, memberCount: 5, updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "proj-002", name: "API Gateway v2", identifier: "AGW", description: "New unified API gateway with n8n orchestration", source: "plane", issueCount: 18, completedCount: 14, memberCount: 3, updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  { id: "proj-003", name: "Enterprise SSO", identifier: "SSO", description: "OIDC-based single sign-on across all services", source: "openproject", issueCount: 11, completedCount: 7, memberCount: 2, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
  { id: "proj-004", name: "Monitoring Stack", identifier: "MON", description: "Observability infrastructure: metrics, traces, logs", source: "openproject", issueCount: 8, completedCount: 2, memberCount: 4, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
];

export const SAMPLE_ISSUES: Record<string, Row[]> = {
  "proj-001": [
    { id: "iss-001", projectId: "proj-001", title: "Migrate auth service to OIDC", description: "Replace legacy JWT flow with OIDC + Authentik", status: "in_progress", priority: "urgent", assignee: "alice", labels: ["auth", "infra"], startDate: "2026-06-10", dueDate: "2026-06-28", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
    { id: "iss-002", projectId: "proj-001", title: "Set up n8n webhook bidirectional flow", description: "Configure n8n to handle both inbound and outbound payloads", status: "todo", priority: "high", assignee: "bob", labels: ["n8n", "integration"], startDate: "2026-06-20", dueDate: "2026-07-05", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
    { id: "iss-003", projectId: "proj-001", title: "Docker compose standalone validation", description: "Verify all services in standalone mode start correctly", status: "in_review", priority: "medium", assignee: "alice", labels: ["devops", "docker"], startDate: null, dueDate: "2026-06-25", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
    { id: "iss-004", projectId: "proj-001", title: "Write K8s manifest for enterprise deployment", description: "ClusterIP services, ingress, configmaps for OIDC vars", status: "backlog", priority: "medium", assignee: null, labels: ["k8s", "devops"], startDate: null, dueDate: null, source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
    { id: "iss-005", projectId: "proj-001", title: "Frontend command palette keyboard navigation", description: "Cmd+K opens cmdk dialog with full action set", status: "done", priority: "high", assignee: "carol", labels: ["frontend", "ux"], startDate: "2026-06-01", dueDate: "2026-06-15", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
    { id: "iss-006", projectId: "proj-001", title: "Traefik routing labels for *.local domains", description: "Configure Traefik reverse proxy for local dev", status: "cancelled", priority: "low", assignee: null, labels: ["infra", "devops"], startDate: null, dueDate: null, source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() },
  ],
  "proj-002": [
    { id: "iss-007", projectId: "proj-002", title: "Rate limiting middleware", description: "Per-IP and per-token rate limiting on all routes", status: "done", priority: "high", assignee: "bob", labels: ["backend", "security"], startDate: "2026-05-20", dueDate: "2026-06-01", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 200).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString() },
    { id: "iss-008", projectId: "proj-002", title: "OpenAPI spec for gateway endpoints", description: "Document all proxy routes in OpenAPI 3.1", status: "done", priority: "medium", assignee: "alice", labels: ["docs", "api"], startDate: "2026-06-01", dueDate: "2026-06-10", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 168).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
    { id: "iss-009", projectId: "proj-002", title: "Health check endpoint", description: "GET /healthz with uptime and dependency status", status: "in_progress", priority: "low", assignee: "carol", labels: ["backend"], startDate: "2026-06-15", dueDate: "2026-06-22", source: "plane", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  ],
  "proj-003": [
    { id: "iss-010", projectId: "proj-003", title: "Authentik local IdP setup", description: "Bundle Authentik with redis + postgres in standalone compose", status: "done", priority: "urgent", assignee: "alice", labels: ["auth", "infra"], startDate: "2026-05-01", dueDate: "2026-05-20", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString() },
    { id: "iss-011", projectId: "proj-003", title: "OIDC token relay in API proxy", description: "Extract Bearer from session, attach to n8n requests", status: "in_progress", priority: "high", assignee: "bob", labels: ["auth", "backend"], startDate: "2026-06-10", dueDate: "2026-06-30", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
  ],
  "proj-004": [
    { id: "iss-012", projectId: "proj-004", title: "Prometheus scrape configs", description: "Configure scrape targets for all services", status: "todo", priority: "medium", assignee: null, labels: ["monitoring", "infra"], startDate: null, dueDate: "2026-07-15", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
  ],
};

// Seed an optimistic-concurrency version on every demo issue so the conflict
// check has a token to compare. A real backend supplies its own (e.g.
// OpenProject lockVersion); the gateway just mirrors it.
for (const list of Object.values(SAMPLE_ISSUES)) {
  for (const issue of list) {
    if (issue["version"] === undefined) issue["version"] = 1;
  }
}

// Optional demo-scale generator for load/e2e testing. Set DEMO_SCALE_PROJECTS=N
// (and optionally DEMO_SCALE_ISSUES=M per project) to synthesise a realistic
// portfolio (e.g. 200 projects × 10 issues) without a backend. Stateless: this
// only inflates the in-memory demo dataset for a single process.
(function seedScale() {
  const n = Number(process.env["DEMO_SCALE_PROJECTS"]);
  if (!Number.isFinite(n) || n <= 0) return;
  const perProject = Math.max(1, Number(process.env["DEMO_SCALE_ISSUES"]) || 10);
  const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];
  const PRIORITIES = ["none", "low", "medium", "high", "urgent"];
  const now = Date.now();
  for (let p = 0; p < n; p++) {
    const pid = `gen-${String(p + 1).padStart(4, "0")}`;
    SAMPLE_PROJECTS.push({
      id: pid,
      name: `Programme ${p + 1}`,
      identifier: `G${p + 1}`,
      description: "Generated demo-scale project",
      source: p % 2 ? "openproject" : "plane",
      issueCount: perProject,
      completedCount: Math.round(perProject / 3),
      memberCount: 3 + (p % 7),
      updatedAt: new Date(now - (p % 30) * 86400000).toISOString(),
    });
    const issues: Row[] = [];
    for (let i = 0; i < perProject; i++) {
      const status = STATUSES[(p + i) % STATUSES.length];
      issues.push({
        id: `${pid}-iss-${i + 1}`,
        projectId: pid,
        title: `Work item ${i + 1} of ${pid}`,
        description: null,
        status,
        priority: PRIORITIES[(i * 3 + p) % PRIORITIES.length],
        assignee: `user-${(p * perProject + i) % 2000}`,
        labels: i % 4 === 0 ? [`sp:${(i % 8) + 1}`] : [],
        startDate: new Date(now - (i % 14) * 86400000).toISOString().slice(0, 10),
        dueDate: new Date(now + (i % 21) * 86400000).toISOString().slice(0, 10),
        source: p % 2 ? "openproject" : "plane",
        version: 1,
        createdAt: new Date(now - (i % 60) * 86400000).toISOString(),
        updatedAt: new Date(now - (i % 5) * 3600000).toISOString(),
      });
    }
    SAMPLE_ISSUES[pid] = issues;
  }
})();

export function sampleActivity(): Row[] {
  return [
    { id: "act-001", action: "status_changed", actor: "alice", projectId: "proj-001", issueId: "iss-005", issueTitle: "Frontend command palette keyboard navigation", detail: "in_progress → done", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
    { id: "act-002", action: "issue_created", actor: "bob", projectId: "proj-001", issueId: "iss-004", issueTitle: "Write K8s manifest for enterprise deployment", detail: null, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
    { id: "act-003", action: "status_changed", actor: "carol", projectId: "proj-002", issueId: "iss-009", issueTitle: "Health check endpoint", detail: "todo → in_progress", timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
    { id: "act-004", action: "priority_changed", actor: "alice", projectId: "proj-001", issueId: "iss-001", issueTitle: "Migrate auth service to OIDC", detail: "high → urgent", timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
  ];
}

const src = () => getSettings().backendSource;

export async function getProjects(req: Request): Promise<Row[]> {
  if (isN8nConfigured) {
    const r = await callN8n<Row[]>("list_projects", {}, { authHeader: authHeaderFromReq(req), source: src() });
    return r.data ?? [];
  }
  return SAMPLE_PROJECTS;
}

export async function getIssues(req: Request, projectId: string): Promise<Row[]> {
  if (isN8nConfigured) {
    const r = await callN8n<Row[]>("list_issues", { projectId }, { authHeader: authHeaderFromReq(req), source: src() });
    return r.data ?? [];
  }
  return SAMPLE_ISSUES[projectId] ?? [];
}

export async function getActivity(req: Request): Promise<Row[]> {
  if (isN8nConfigured) {
    const r = await callN8n<Row[]>("list_activity", {}, { authHeader: authHeaderFromReq(req), source: src() });
    return r.data ?? [];
  }
  return sampleActivity();
}

export interface Summary {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  completionRate: number;
  overdue: number;
}

export async function getSummary(req: Request, projectId: string): Promise<Summary> {
  if (isN8nConfigured) {
    const r = await callN8n<Summary>("project_summary", { projectId }, { authHeader: authHeaderFromReq(req), source: src() });
    return r.data as Summary;
  }

  const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ status: string; priority: string; dueDate: string | null }>;
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let overdue = 0;
  const now = new Date();
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    byPriority[issue.priority] = (byPriority[issue.priority] ?? 0) + 1;
    if (issue.dueDate && new Date(issue.dueDate) < now && issue.status !== "done" && issue.status !== "cancelled") overdue++;
  }
  const total = issues.length;
  const completionRate = total > 0 ? Math.round(((byStatus["done"] ?? 0) / total) * 100) : 0;
  return { projectId, total, byStatus, byPriority, completionRate, overdue };
}

// ── History (backend-sourced; demo derives a plausible trend from issues) ──────
//
// OmniProject keeps no history of its own — the system of record (OpenProject
// journals, Jira changelog, etc.) is authoritative. When n8n is wired we ask it
// for the real trend (get_project_history). In demo mode we *derive* a smooth
// trend that lands on the project's current completion, and label it "derived"
// so the UI never presents it as recorded fact.

export interface HistoryPoint {
  date: string;
  completionRate: number;
  totalIssues: number;
  completedIssues: number;
  openBlockers: number | null;
  provenance: "sourced" | "derived" | "sample";
}

export async function getHistory(req: Request, projectId: string): Promise<HistoryPoint[]> {
  if (isN8nConfigured) {
    const r = await callN8n<HistoryPoint[]>("get_project_history", { projectId }, { authHeader: authHeaderFromReq(req), source: "history_provider" });
    return (r.data ?? []).map((p) => ({ ...p, provenance: p.provenance ?? "sourced" }));
  }

  const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ status: string }>;
  const total = issues.length;
  const done = issues.filter((i) => i.status === "done").length;
  const finalRate = total > 0 ? Math.round((done / total) * 100) : 0;
  const weeks = 8;
  const out: HistoryPoint[] = [];
  for (let w = weeks; w >= 0; w--) {
    const t = (weeks - w) / weeks; // 0 → 1
    const eased = t * (2 - t); // ease-out toward the current value
    const rate = Math.round(finalRate * eased);
    out.push({
      date: new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      completionRate: rate,
      totalIssues: total,
      completedIssues: Math.round((rate / 100) * total),
      openBlockers: null,
      provenance: "derived",
    });
  }
  return out;
}

// ── Baseline (held by the backend; demo derives one from issue dates) ──────────

export interface Baseline {
  projectId: string;
  name?: string;
  capturedAt: string;
  items: Array<{ issueId: string; title: string; plannedStart: string | null; plannedFinish: string | null }>;
  provenance: "sourced" | "derived" | "sample";
}

export async function getBaseline(req: Request, projectId: string): Promise<Baseline | null> {
  if (isN8nConfigured) {
    const r = await callN8n<Baseline | null>("get_baseline", { projectId }, { authHeader: authHeaderFromReq(req), source: "baseline_store" });
    return r.data ? { ...r.data, provenance: r.data.provenance ?? "sourced" } : null;
  }

  const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ id: string; title: string; startDate: string | null; dueDate: string | null }>;
  const items = issues
    .filter((i) => i.startDate || i.dueDate)
    .map((i) => ({ issueId: i.id, title: i.title, plannedStart: i.startDate ?? null, plannedFinish: i.dueDate ?? null }));
  if (items.length === 0) return null;
  return {
    projectId,
    name: "Demo baseline (derived from planned dates)",
    capturedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    items,
    provenance: "sample",
  };
}

// ── RAID (Risks, Assumptions, Issues, Dependencies) ───────────────────────────

export const SAMPLE_RAID: Record<string, Row[]> = {
  "proj-001": [
    { id: "raid-001", projectId: "proj-001", type: "risk", title: "OIDC provider migration may slip the auth cutover", description: "Authentik upgrade has a hard dependency on the new realm export format.", severity: "high", likelihood: "medium", impact: "high", status: "mitigating", owner: "alice", mitigation: "Spike the export on a staging realm before committing the cutover date.", dueDate: "2026-07-01", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
    { id: "raid-002", projectId: "proj-001", type: "dependency", title: "n8n workflow blueprint sign-off from platform team", description: "Core sync workflow needs platform review before go-live.", severity: "medium", likelihood: null, impact: null, status: "open", owner: "bob", mitigation: null, dueDate: "2026-06-30", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString() },
    { id: "raid-003", projectId: "proj-001", type: "assumption", title: "Backend exposes lockVersion for optimistic concurrency", description: "Assuming OpenProject lockVersion is surfaced through n8n normalization.", severity: "low", likelihood: null, impact: null, status: "open", owner: null, mitigation: null, dueDate: null, provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
  ],
  "proj-002": [
    { id: "raid-004", projectId: "proj-002", type: "issue", title: "Rate limiter rejects Power BI scheduled refresh under burst", description: "BI token hit the analytics limiter during a 6am refresh window.", severity: "medium", likelihood: null, impact: null, status: "open", owner: "carol", mitigation: "Raise the analytics window or whitelist the BI token key.", dueDate: "2026-06-26", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
  ],
};

let raidCounter = 100;

export async function getRaid(req: Request, projectId: string): Promise<Row[]> {
  if (isN8nConfigured) {
    const r = await callN8n<Row[]>("get_raid", { projectId }, { authHeader: authHeaderFromReq(req), source: "raid_register" });
    return (r.data ?? []).map((e) => ({ provenance: "sourced", ...e }));
  }
  return SAMPLE_RAID[projectId] ?? [];
}

export function createSampleRaid(projectId: string, body: Record<string, unknown>): Row {
  const now = new Date().toISOString();
  const entry: Row = {
    id: `raid-${++raidCounter}`,
    projectId,
    type: body["type"],
    title: body["title"],
    description: body["description"] ?? null,
    severity: body["severity"],
    likelihood: body["likelihood"] ?? null,
    impact: body["impact"] ?? null,
    status: body["status"] ?? "open",
    owner: body["owner"] ?? null,
    mitigation: body["mitigation"] ?? null,
    dueDate: body["dueDate"] ?? null,
    provenance: "sample",
    createdAt: now,
    updatedAt: now,
  };
  if (!SAMPLE_RAID[projectId]) SAMPLE_RAID[projectId] = [];
  SAMPLE_RAID[projectId].unshift(entry);
  return entry;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function getNotifications(req: Request): Promise<Row[]> {
  if (isN8nConfigured) {
    const r = await callN8n<Row[]>("get_notifications", {}, { authHeader: authHeaderFromReq(req), source: "notification_center" });
    return r.data ?? [];
  }
  return [
    { id: "ntf-001", kind: "assignment", title: "Assigned: Migrate auth service to OIDC", body: "alice assigned you on Platform Rewrite.", projectId: "proj-001", issueId: "iss-001", read: false, timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString() },
    { id: "ntf-002", kind: "due_soon", title: "Due soon: Docker compose standalone validation", body: "Due 2026-06-25.", projectId: "proj-001", issueId: "iss-003", read: false, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
    { id: "ntf-003", kind: "blocker", title: "Risk escalated on Platform Rewrite", body: "OIDC provider migration moved to mitigating.", projectId: "proj-001", issueId: null, read: true, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  ];
}
