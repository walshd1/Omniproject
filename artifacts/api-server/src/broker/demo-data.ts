import { DEV_PERSIST_FILE, saveState, loadState } from "../lib/dev-persist";
import { INDICATIVE_FX_RATES } from "../lib/fx-fallback";
import { CANONICAL_STATUS, CANONICAL_PRIORITY, isDone } from "./vocabulary";
import type { Row, FxRates } from "./types";

/**
 * Demo dataset — the canned data the DemoBroker serves. Lives entirely under the
 * broker seam so nothing above it embeds sample data. Includes the optional
 * stateful-dev-mode persistence (DEV_PERSIST_FILE) the developer debug bundle
 * relies on.
 */

// Whether a real backend is wired, read locally (no import of the n8n adapter,
// to avoid a cycle and its module side-effects). Used only to gate dev-mode
// persistence, which is meaningless when a real backend is the source of record.
// `N8N_WEBHOOK_URL` is the deprecated pre-0.2.0 alias for `BROKER_URL`.
const BACKEND_CONFIGURED = !!(process.env["BROKER_URL"] ?? process.env["N8N_WEBHOOK_URL"])?.trim();

// Demo project rows carry denormalised financial fields (budget/actualCost/…) so
// the programme roll-up and per-project financials have something to surface. A
// real finance-backed deployment denormalises these the same way as issueCount;
// a backend with no finance source simply omits them and financials stay hidden.
export const SAMPLE_PROJECTS: Row[] = [
  { id: "proj-001", name: "Platform Rewrite", identifier: "PLT", description: "Complete overhaul of the core platform infrastructure", source: "jira", programmeId: "prog-platform", programmeName: "Platform Modernization", issueCount: 24, completedCount: 9, memberCount: 5, currency: "GBP", budget: 480000, actualCost: 312000, earnedValue: 288000, committed: 52000, updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "proj-002", name: "API Gateway v2", identifier: "AGW", description: "New unified API gateway", source: "openproject", programmeId: "prog-platform", programmeName: "Platform Modernization", issueCount: 18, completedCount: 14, memberCount: 3, currency: "GBP", budget: 220000, actualCost: 148000, updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  { id: "proj-003", name: "Enterprise SSO", identifier: "SSO", description: "OIDC-based single sign-on across all services", source: "github", programmeId: "prog-security", programmeName: "Security & Identity", issueCount: 11, completedCount: 7, memberCount: 2, currency: "GBP", budget: 140000, actualCost: 96000, earnedValue: 88000, committed: 9000, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
  { id: "proj-004", name: "Monitoring Stack", identifier: "MON", description: "Observability infrastructure: metrics, traces, logs", source: "azure-devops", programmeId: null, programmeName: null, issueCount: 8, completedCount: 2, memberCount: 4, currency: "GBP", budget: 90000, actualCost: 61000, earnedValue: 52000, committed: 7000, updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
];

export const SAMPLE_ISSUES: Record<string, Row[]> = {
  "proj-001": [
    { id: "iss-001", projectId: "proj-001", title: "Migrate auth service to OIDC", description: "Replace legacy JWT flow with OIDC + Authentik", status: "in_progress", priority: "urgent", assignee: "alice", labels: ["auth", "infra"], startDate: "2026-06-10", dueDate: "2026-06-28", currency: "GBP", budget: 45000, actualCost: 28000, billable: true, costCenter: "ENG-PLAT", estimateHours: 40, loggedHours: 26, remainingHours: 18, storyPoints: 8, healthStatus: "amber", riskLevel: "high", impact: "high", urgency: "high", blocked: true, blockedReason: "Awaiting realm export format from platform team", defectCount: 2, customFields: { customerTier: "Enterprise", riskScore: 72 }, source: "jira", lastUpdatedBy: "alice", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
    { id: "iss-002", projectId: "proj-001", title: "Set up bidirectional broker flow", description: "Configure the broker to handle inbound and outbound payloads", status: "todo", priority: "high", assignee: "bob", labels: ["integration"], startDate: "2026-06-20", dueDate: "2026-07-05", currency: "GBP", budget: 30000, actualCost: 6000, billable: true, costCenter: "ENG-PLAT", estimateHours: 24, loggedHours: 4, remainingHours: 20, storyPoints: 5, customFields: { customerTier: "Mid-market", riskScore: 31 }, source: "jira", lastUpdatedBy: "bob", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
    { id: "iss-003", projectId: "proj-001", title: "Docker compose standalone validation", description: "Verify all services in standalone mode start correctly", status: "in_review", priority: "medium", assignee: "alice", labels: ["devops", "docker"], startDate: null, dueDate: "2026-06-25", source: "jira", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
    { id: "iss-004", projectId: "proj-001", title: "Write K8s manifest for enterprise deployment", description: "ClusterIP services, ingress, configmaps for OIDC vars", status: "backlog", priority: "medium", assignee: null, labels: ["k8s", "devops"], startDate: null, dueDate: null, source: "jira", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
    { id: "iss-005", projectId: "proj-001", title: "Frontend command palette keyboard navigation", description: "Cmd+K opens cmdk dialog with full action set", status: "done", priority: "high", assignee: "carol", labels: ["frontend", "ux"], startDate: "2026-06-01", dueDate: "2026-06-15", source: "jira", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
    { id: "iss-006", projectId: "proj-001", title: "Traefik routing labels for *.local domains", description: "Configure Traefik reverse proxy for local dev", status: "cancelled", priority: "low", assignee: null, labels: ["infra", "devops"], startDate: null, dueDate: null, source: "jira", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() },
  ],
  "proj-002": [
    { id: "iss-007", projectId: "proj-002", title: "Rate limiting middleware", description: "Per-IP and per-token rate limiting on all routes", status: "done", priority: "high", assignee: "bob", labels: ["backend", "security"], startDate: "2026-05-20", dueDate: "2026-06-01", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 200).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString() },
    { id: "iss-008", projectId: "proj-002", title: "OpenAPI spec for gateway endpoints", description: "Document all proxy routes in OpenAPI 3.1", status: "done", priority: "medium", assignee: "alice", labels: ["docs", "api"], startDate: "2026-06-01", dueDate: "2026-06-10", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 168).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
    { id: "iss-009", projectId: "proj-002", title: "Health check endpoint", description: "GET /healthz with uptime and dependency status", status: "in_progress", priority: "low", assignee: "carol", labels: ["backend"], startDate: "2026-06-15", dueDate: "2026-06-22", source: "openproject", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  ],
  "proj-003": [
    { id: "iss-010", projectId: "proj-003", title: "Authentik local IdP setup", description: "Bundle Authentik with redis + postgres in standalone compose", status: "done", priority: "urgent", assignee: "alice", labels: ["auth", "infra"], startDate: "2026-05-01", dueDate: "2026-05-20", source: "github", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString() },
    { id: "iss-011", projectId: "proj-003", title: "OIDC token relay in API proxy", description: "Extract Bearer from session, attach to brokered requests", status: "in_progress", priority: "high", assignee: "bob", labels: ["auth", "backend"], startDate: "2026-06-10", dueDate: "2026-06-30", source: "github", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
  ],
  "proj-004": [
    { id: "iss-012", projectId: "proj-004", title: "Prometheus scrape configs", description: "Configure scrape targets for all services", status: "todo", priority: "medium", assignee: null, labels: ["monitoring", "infra"], startDate: null, dueDate: "2026-07-15", source: "azure-devops", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
  ],
};

// Seed an optimistic-concurrency version on every demo issue so the conflict
// check has a token to compare. A real backend supplies its own.
for (const list of Object.values(SAMPLE_ISSUES)) {
  for (const issue of list) {
    if (issue["version"] === undefined) issue["version"] = 1;
  }
}

// Optional demo-scale generator for load/e2e testing (DEMO_SCALE_PROJECTS=N).
(function seedScale() {
  const n = Number(process.env["DEMO_SCALE_PROJECTS"]);
  if (!Number.isFinite(n) || n <= 0) return;
  const perProject = Math.max(1, Number(process.env["DEMO_SCALE_ISSUES"]) || 10);
  const STATUSES = [...CANONICAL_STATUS];
  const PRIORITIES = [...CANONICAL_PRIORITY];
  const now = Date.now();
  for (let p = 0; p < n; p++) {
    const pid = `gen-${String(p + 1).padStart(4, "0")}`;
    const grp = Math.floor(p / 10);
    const standalone = p % 7 === 0;
    SAMPLE_PROJECTS.push({
      id: pid, name: `Project ${p + 1}`, identifier: `G${p + 1}`, description: "Generated demo-scale project",
      source: p % 2 ? "openproject" : "plane",
      programmeId: standalone ? null : `gen-prog-${grp}`, programmeName: standalone ? null : `Generated Programme ${grp + 1}`,
      issueCount: perProject, completedCount: Math.round(perProject / 3), memberCount: 3 + (p % 7),
      updatedAt: new Date(now - (p % 30) * 86400000).toISOString(),
    });
    const issues: Row[] = [];
    for (let i = 0; i < perProject; i++) {
      const status = STATUSES[(p + i) % STATUSES.length];
      issues.push({
        id: `${pid}-iss-${i + 1}`, projectId: pid, title: `Work item ${i + 1} of ${pid}`, description: null, status,
        priority: PRIORITIES[(i * 3 + p) % PRIORITIES.length], assignee: `user-${(p * perProject + i) % 2000}`,
        labels: i % 4 === 0 ? [`sp:${(i % 8) + 1}`] : [],
        startDate: new Date(now - (i % 14) * 86400000).toISOString().slice(0, 10),
        dueDate: new Date(now + (i % 21) * 86400000).toISOString().slice(0, 10),
        source: p % 2 ? "openproject" : "plane", version: 1,
        createdAt: new Date(now - (i % 60) * 86400000).toISOString(), updatedAt: new Date(now - (i % 5) * 3600000).toISOString(),
      });
    }
    SAMPLE_ISSUES[pid] = issues;
  }
})();

// Keep each project's issueCount/completedCount in lock-step with its seeded
// issues so the demo is internally consistent across /projects, /summary,
// /history and /metrics (otherwise the project-card completion % derived from
// these counts would disagree with the board's actual issues). "Completed"
// mirrors the summary's definition (a done-class status — isDone). Projects with
// no seeded issues are left untouched.
for (const project of SAMPLE_PROJECTS) {
  const issues = SAMPLE_ISSUES[project["id"] as string];
  if (!issues?.length) continue;
  project["issueCount"] = issues.length;
  project["completedCount"] = issues.filter((i) => isDone(i["status"] as string)).length;
}

/** Canned activity-feed rows for demo mode (no backend). */
export function sampleActivity(): Row[] {
  return [
    { id: "act-001", action: "status_changed", actor: "alice", projectId: "proj-001", issueId: "iss-005", issueTitle: "Frontend command palette keyboard navigation", detail: "in_progress → done", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
    { id: "act-002", action: "issue_created", actor: "bob", projectId: "proj-001", issueId: "iss-004", issueTitle: "Write K8s manifest for enterprise deployment", detail: null, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
    { id: "act-003", action: "status_changed", actor: "carol", projectId: "proj-002", issueId: "iss-009", issueTitle: "Health check endpoint", detail: "todo → in_progress", timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
    { id: "act-004", action: "priority_changed", actor: "alice", projectId: "proj-001", issueId: "iss-001", issueTitle: "Migrate auth service to OIDC", detail: "high → urgent", timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
  ];
}

export const SAMPLE_RAID: Record<string, Row[]> = {
  "proj-001": [
    { id: "raid-001", projectId: "proj-001", type: "risk", title: "OIDC provider migration may slip the auth cutover", description: "Authentik upgrade has a hard dependency on the new realm export format.", severity: "high", likelihood: "medium", impact: "high", status: "mitigating", owner: "alice", mitigation: "Spike the export on a staging realm before committing the cutover date.", dueDate: "2026-07-01", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
    { id: "raid-002", projectId: "proj-001", type: "dependency", title: "Workflow blueprint sign-off from platform team", description: "Core sync workflow needs platform review before go-live.", severity: "medium", likelihood: null, impact: null, status: "open", owner: "bob", mitigation: null, dueDate: "2026-06-30", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString() },
    { id: "raid-003", projectId: "proj-001", type: "assumption", title: "Backend exposes lockVersion for optimistic concurrency", description: "Assuming OpenProject lockVersion is surfaced through normalization.", severity: "low", likelihood: null, impact: null, status: "open", owner: null, mitigation: null, dueDate: null, provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
  ],
  "proj-002": [
    { id: "raid-004", projectId: "proj-002", type: "issue", title: "Rate limiter rejects Power BI scheduled refresh under burst", description: "BI token hit the analytics limiter during a 6am refresh window.", severity: "medium", likelihood: null, impact: null, status: "open", owner: "carol", mitigation: "Raise the analytics window or whitelist the BI token key.", dueDate: "2026-06-26", provenance: "sample", createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
  ],
};

export const SAMPLE_CAPACITY: Row[] = [
  { resourceId: "u-alice", resourceName: "Alice Tan", role: "Senior DevOps", allocationPercentage: 120, assignedHours: 48, availableHours: 40, utilizationState: "OVER_ALLOCATED" },
  { resourceId: "u-bob", resourceName: "Bob Reyes", role: "Backend Engineer", allocationPercentage: 95, assignedHours: 38, availableHours: 40, utilizationState: "OPTIMAL" },
  { resourceId: "u-carol", resourceName: "Carol Singh", role: "Frontend Engineer", allocationPercentage: 60, assignedHours: 24, availableHours: 40, utilizationState: "UNDER_ALLOCATED" },
  { resourceId: "u-dan", resourceName: "Dan Whitfield", role: "QA Lead", allocationPercentage: 105, assignedHours: 42, availableHours: 40, utilizationState: "OVER_ALLOCATED" },
];

export const SAMPLE_FINANCIALS: Row = {
  currency: "GBP", budgetAllocated: 480000, actualBurn: 312000, earnedValue: 288000,
  cpi: 0.92, spi: 0.88, financialHealth: "AMBER", forecastCostAtCompletion: 521739, provenance: "sample",
};

export const SAMPLE_PORTFOLIO: Row[] = [
  { projectId: "proj-001", projectName: "Platform Rewrite", ragStatus: "AMBER", scheduleVarianceDays: -6, budgetVariancePercentage: 8.4, activeBlockersCount: 3 },
  { projectId: "proj-002", projectName: "API Gateway v2", ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: -1.2, activeBlockersCount: 0 },
  { projectId: "proj-003", projectName: "Enterprise SSO", ragStatus: "RED", scheduleVarianceDays: -14, budgetVariancePercentage: 22.7, activeBlockersCount: 5 },
  { projectId: "proj-004", projectName: "Monitoring Stack", ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: 3.1, activeBlockersCount: 1 },
];

/** Canned notification rows for demo mode (no backend). */
export function sampleNotifications(): Row[] {
  return [
    { id: "ntf-001", kind: "assignment", title: "Assigned: Migrate auth service to OIDC", body: "alice assigned you on Platform Rewrite.", projectId: "proj-001", issueId: "iss-001", read: false, timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString() },
    { id: "ntf-002", kind: "due_soon", title: "Due soon: Docker compose standalone validation", body: "Due 2026-06-25.", projectId: "proj-001", issueId: "iss-003", read: false, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
    { id: "ntf-003", kind: "blocker", title: "Risk escalated on Platform Rewrite", body: "OIDC provider migration moved to mitigating.", projectId: "proj-001", issueId: null, read: true, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  ];
}

// Indicative sample rates, shared with the n8n adapter's fallback (single source
// of truth in lib/fx-fallback) so the demo and fallback tables can't drift.
export const DEMO_FX: FxRates = INDICATIVE_FX_RATES;

// ── Stateful dev mode (opt-in via DEV_PERSIST_FILE; demo only) ─────────────────

/** Current in-memory demo dataset (for the developer debug bundle). */
export function getDemoState(): { projects: Row[]; issues: Record<string, Row[]>; raid: Record<string, Row[]> } {
  return { projects: SAMPLE_PROJECTS, issues: SAMPLE_ISSUES, raid: SAMPLE_RAID };
}

/** Persist the in-memory demo dataset so it survives a restart (dev/test only). */
export function persistDemoState(): void {
  if (!DEV_PERSIST_FILE) return;
  try {
    saveState(DEV_PERSIST_FILE, { projects: SAMPLE_PROJECTS, issues: SAMPLE_ISSUES, raid: SAMPLE_RAID });
  } catch {
    /* best-effort; dev convenience only */
  }
}

// Hydrate the demo dataset from disk on boot when stateful dev mode is enabled.
/**
 * Replace the in-memory demo dataset with a supplied one (projects/issues/raid) —
 * the loader behind both stateful-dev hydration and the dev broker's "bundle" data
 * source (load a debug bundle's demo-state.json on the fly). Mutates the existing
 * arrays/maps in place so every holder of the references sees the new data.
 */
export function loadDemoState(state: { projects: unknown[]; issues: Record<string, unknown[]>; raid: Record<string, unknown[]> }): void {
  SAMPLE_PROJECTS.splice(0, SAMPLE_PROJECTS.length, ...(state.projects as Row[]));
  for (const k of Object.keys(SAMPLE_ISSUES)) delete SAMPLE_ISSUES[k];
  Object.assign(SAMPLE_ISSUES, state.issues as Record<string, Row[]>);
  for (const k of Object.keys(SAMPLE_RAID)) delete SAMPLE_RAID[k];
  Object.assign(SAMPLE_RAID, state.raid as Record<string, Row[]>);
}

if (DEV_PERSIST_FILE && !BACKEND_CONFIGURED) {
  const saved = loadState(DEV_PERSIST_FILE);
  if (saved) loadDemoState(saved);
}
