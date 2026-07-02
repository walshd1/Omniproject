import crypto from "node:crypto";
import { getSettings } from "../lib/settings";
import { versionConflict } from "../lib/concurrency";
import { CAPABILITY_DOMAINS, FIELD_KEYS, ENTITY_KEYS } from "../lib/capabilities";
import { isDone, isClosed } from "./vocabulary";
import {
  SAMPLE_PROJECTS, SAMPLE_ISSUES, SAMPLE_RAID, SAMPLE_CAPACITY, SAMPLE_FINANCIALS,
  SAMPLE_PORTFOLIO, DEMO_FX, sampleActivity, sampleNotifications, persistDemoState,
} from "./demo-data";
import {
  BrokerError,
  type Broker,
  type ActorContext,
  type Project,
  type Issue,
  type IssueWrite,
  type ProjectWrite,
  type ProjectMember,
  type TaskItem,
  type TaskItemWrite,
  type Summary,
  type HistoryPoint,
  type HistoryState,
  type Baseline,
  type PortfolioRow,
  type FxRates,
  type CapabilityFlags,
  type VerifyReport,
  type Row,
} from "./types";

/**
 * Demo broker — the fake adapter. Serves canned sample data, needs no network
 * and no n8n. It is the proof the seam is clean (the whole app runs against it)
 * and the offline/CI harness. All demo behaviour lives here; there is no longer
 * a parallel "demo branch" interleaved into the callers.
 */


let issueCounter = 100;
let raidCounter = 100;
let projectCounter = 100;
let taskItemCounter = 100;
/** In-memory child issues/notes per task (demo only). */
const SAMPLE_TASK_ITEMS: Record<string, TaskItem[]> = {};

/**
 * Illustrative canonical → backend native field mapping, so the demo can show
 * granular lineage ("dueDate ← <system>:duedate"). The mechanism is
 * backend-agnostic: real brokers/workflows supply the true map per backend via
 * describeFields (with their own sourceSystem). These sample names are
 * Jira-shaped purely as an example; unmapped keys fall back to the canonical name.
 */
const SAMPLE_NATIVE_FIELDS: Record<string, string> = {
  title: "summary", description: "description", status: "status", priority: "priority",
  assignee: "assignee", reporter: "reporter", labels: "labels", dueDate: "duedate",
  startDate: "customfield_10015", storyPoints: "customfield_10016", sprint: "customfield_10020",
  epic: "customfield_10014", estimateHours: "timeoriginalestimate", loggedHours: "timespent",
  remainingHours: "timeestimate", completionPct: "aggregateprogress", healthStatus: "customfield_10050",
  blocked: "customfield_10051", blockedReason: "customfield_10052", budget: "customfield_10100",
  actualCost: "customfield_10101", billable: "customfield_10102",
};

/**
 * Recompute a project row's denormalised issueCount/completedCount from its
 * actual issues after a mutation, mirroring the initial-seed reconcile in
 * demo-data. The project card reads these counts for its completion %, so they
 * must move when an issue is created/deleted OR when a status crosses done —
 * otherwise the card drifts from the board and the (always-recomputed) summary.
 * "Completed" matches the summary definition (a done-class status — isDone).
 */
function recountProject(projectId: string): void {
  const proj = SAMPLE_PROJECTS.find((p) => p["id"] === projectId);
  if (!proj) return;
  const issues = SAMPLE_ISSUES[projectId] ?? [];
  proj["issueCount"] = issues.length;
  proj["completedCount"] = issues.filter((i) => isDone((i as { status?: string }).status)).length;
}

export class DemoBroker implements Broker {
  readonly kind = "demo";
  readonly live = false;

  async listProjects(): Promise<Project[]> {
    return SAMPLE_PROJECTS as unknown as Project[];
  }

  async listIssues(_ctx: ActorContext, projectId: string): Promise<Issue[]> {
    return (SAMPLE_ISSUES[projectId] ?? []) as unknown as Issue[];
  }

  async createProject(_ctx: ActorContext, input: ProjectWrite): Promise<Project> {
    const id = `proj-${++projectCounter}`;
    const project: Row = {
      id,
      name: input.name ?? "Untitled project",
      identifier: input.identifier ?? id.toUpperCase(),
      description: input.description ?? null,
      source: getSettings().backendSource || "plane",
      programmeId: input.programmeId ?? null,
      programmeName: null,
      issueCount: 0,
      completedCount: 0,
      memberCount: 1,
      updatedAt: new Date().toISOString(),
    };
    SAMPLE_PROJECTS.push(project);
    persistDemoState();
    return project as unknown as Project;
  }

  async updateProject(_ctx: ActorContext, projectId: string, input: ProjectWrite): Promise<Project> {
    const proj = SAMPLE_PROJECTS.find((p) => p["id"] === projectId);
    if (!proj) throw new BrokerError("not_found", "Project not found");
    if (input.name !== undefined) proj["name"] = input.name;
    if (input.description !== undefined) proj["description"] = input.description;
    if (input.programmeId !== undefined) proj["programmeId"] = input.programmeId;
    proj["updatedAt"] = new Date().toISOString();
    persistDemoState();
    return proj as unknown as Project;
  }

  async getIssue(_ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null> {
    const found = (SAMPLE_ISSUES[projectId] ?? []).find((i) => (i as { id: string }).id === issueId);
    return (found as unknown as Issue) ?? null;
  }

  async writeIssue(_ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null> {
    const { projectId, issueId } = input;
    if (op === "create") {
      const backend = getSettings().backendSource;
      const issue: Row = {
        id: `iss-${++issueCounter}`,
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "backlog",
        priority: input.priority ?? "none",
        assignee: input.assignee ?? null,
        labels: input.labels ?? [],
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        // Optional per-task financials — only carried when supplied.
        ...(input.budget != null ? { budget: input.budget } : {}),
        ...(input.actualCost != null ? { actualCost: input.actualCost } : {}),
        ...(input.billable != null ? { billable: input.billable } : {}),
        ...(input.costCenter ? { costCenter: input.costCenter } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        // Optional effort / time-tracking — only carried when supplied.
        ...(input.estimateHours != null ? { estimateHours: input.estimateHours } : {}),
        ...(input.loggedHours != null ? { loggedHours: input.loggedHours } : {}),
        ...(input.remainingHours != null ? { remainingHours: input.remainingHours } : {}),
        ...(input.storyPoints != null ? { storyPoints: input.storyPoints } : {}),
        // Optional risk & quality — only carried when supplied.
        ...(input.healthStatus != null ? { healthStatus: input.healthStatus } : {}),
        ...(input.riskLevel != null ? { riskLevel: input.riskLevel } : {}),
        ...(input.impact != null ? { impact: input.impact } : {}),
        ...(input.urgency != null ? { urgency: input.urgency } : {}),
        ...(input.blocked != null ? { blocked: input.blocked } : {}),
        ...(input.blockedReason != null ? { blockedReason: input.blockedReason } : {}),
        ...(input.mitigation != null ? { mitigation: input.mitigation } : {}),
        ...(input.defectCount != null ? { defectCount: input.defectCount } : {}),
        source: backend || "demo",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!SAMPLE_ISSUES[projectId]) SAMPLE_ISSUES[projectId] = [];
      SAMPLE_ISSUES[projectId].push(issue);
      recountProject(projectId);
      persistDemoState();
      return issue as unknown as Issue;
    }

    const issues = SAMPLE_ISSUES[projectId];
    if (!issues) throw new BrokerError("not_found", "Project not found");

    if (op === "delete") {
      const idx = issues.findIndex((i) => (i as { id: string }).id === issueId);
      if (idx !== -1) issues.splice(idx, 1);
      recountProject(projectId);
      persistDemoState();
      return null;
    }

    // update
    const idx = issues.findIndex((i) => (i as { id: string }).id === issueId);
    if (idx === -1) throw new BrokerError("not_found", "Issue not found");
    const current = issues[idx] as Record<string, unknown>;
    const currentVersion = typeof current["version"] === "number" ? (current["version"] as number) : 1;
    if (versionConflict(input.expectedVersion, currentVersion)) {
      throw new BrokerError("conflict", "Issue was modified by someone else", current);
    }
    const { projectId: _p, issueId: _i, expectedVersion: _ev, ...patch } = input;
    const updated = { ...current, ...patch, version: currentVersion + 1, updatedAt: new Date().toISOString() };
    issues[idx] = updated;
    recountProject(projectId); // a status change to/from "done" moves completedCount
    persistDemoState();
    return updated as unknown as Issue;
  }

  async projectMembers(_ctx: ActorContext, _projectId: string): Promise<ProjectMember[]> {
    // Sample membership — a mix of write and read access, so the assignee picker
    // (write-only) visibly differs from the full roster.
    return [
      { id: "u-ada", name: "Ada Lovelace", email: "ada@demo.local", access: "write", skills: ["backend", "architecture"], availableHours: 40, allocatedHours: 28 },
      { id: "u-grace", name: "Grace Hopper", email: "grace@demo.local", access: "write", skills: ["compilers", "leadership"], availableHours: 32, allocatedHours: 30 },
      { id: "u-alan", name: "Alan Turing", email: "alan@demo.local", access: "read", skills: ["research"], availableHours: 20, allocatedHours: 5 },
    ];
  }

  async listTaskItems(_ctx: ActorContext, _projectId: string, taskId: string): Promise<TaskItem[]> {
    return SAMPLE_TASK_ITEMS[taskId] ?? [];
  }

  async createTaskItem(ctx: ActorContext, _projectId: string, taskId: string, input: TaskItemWrite): Promise<TaskItem> {
    const item: TaskItem = {
      id: `ti-${++taskItemCounter}`,
      taskId,
      kind: input.kind,
      content: input.content,
      author: ctx.email ?? ctx.name ?? "demo@local",
      createdAt: new Date().toISOString(),
    };
    (SAMPLE_TASK_ITEMS[taskId] ??= []).push(item);
    persistDemoState();
    return item;
  }

  async listActivity(): Promise<Row[]> {
    return sampleActivity();
  }

  async projectSummary(_ctx: ActorContext, projectId: string): Promise<Summary> {
    const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ status: string; priority: string; dueDate: string | null }>;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let overdue = 0;
    const now = new Date();
    for (const issue of issues) {
      byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
      byPriority[issue.priority] = (byPriority[issue.priority] ?? 0) + 1;
      if (issue.dueDate && new Date(issue.dueDate) < now && !isClosed(issue.status)) overdue++;
    }
    const total = issues.length;
    const doneCount = issues.filter((i) => isDone(i.status)).length;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    return { projectId, total, byStatus, byPriority, completionRate, overdue };
  }

  async projectHistory(_ctx: ActorContext, projectId: string): Promise<HistoryPoint[]> {
    const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ status: string }>;
    const total = issues.length;
    const done = issues.filter((i) => isDone(i.status)).length;
    const finalRate = total > 0 ? Math.round((done / total) * 100) : 0;
    const weeks = 8;
    const out: HistoryPoint[] = [];
    for (let w = weeks; w >= 0; w--) {
      const t = (weeks - w) / weeks;
      const eased = t * (2 - t);
      const rate = Math.round(finalRate * eased);
      out.push({
        date: new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        completionRate: rate, totalIssues: total, completedIssues: Math.round((rate / 100) * total),
        openBlockers: null, provenance: "derived",
      });
    }
    return out;
  }

  async baseline(_ctx: ActorContext, projectId: string): Promise<Baseline | null> {
    const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ id: string; title: string; startDate: string | null; dueDate: string | null }>;
    const items = issues
      .filter((i) => i.startDate || i.dueDate)
      .map((i) => ({ issueId: i.id, title: i.title, plannedStart: i.startDate ?? null, plannedFinish: i.dueDate ?? null }));
    if (items.length === 0) return null;
    return {
      projectId, name: "Demo baseline (derived from planned dates)",
      capturedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
      items, provenance: "sample",
    };
  }

  async listRaid(_ctx: ActorContext, projectId: string): Promise<Row[]> {
    return SAMPLE_RAID[projectId] ?? [];
  }

  async addRaid(_ctx: ActorContext, projectId: string, body: Record<string, unknown>): Promise<Row> {
    const now = new Date().toISOString();
    const entry: Row = {
      id: `raid-${++raidCounter}`, projectId,
      type: body["type"], title: body["title"], description: body["description"] ?? null,
      severity: body["severity"], likelihood: body["likelihood"] ?? null, impact: body["impact"] ?? null,
      status: body["status"] ?? "open", owner: body["owner"] ?? null, mitigation: body["mitigation"] ?? null,
      dueDate: body["dueDate"] ?? null, provenance: "sample", createdAt: now, updatedAt: now,
    };
    if (!SAMPLE_RAID[projectId]) SAMPLE_RAID[projectId] = [];
    SAMPLE_RAID[projectId].unshift(entry);
    persistDemoState();
    return entry;
  }

  async notifications(): Promise<Row[]> {
    return sampleNotifications();
  }

  async portfolioHealth(): Promise<PortfolioRow[]> {
    return SAMPLE_PORTFOLIO as unknown as PortfolioRow[];
  }

  async resourceCapacity(): Promise<Row[]> {
    return SAMPLE_CAPACITY;
  }

  async projectFinancials(): Promise<Row> {
    return SAMPLE_FINANCIALS;
  }

  async capabilities(): Promise<CapabilityFlags> {
    // Reuse the contract's authoritative domain list so the demo adapter's
    // "everything available" map can't drift from the real domain set. Read
    // lazily here (not a module-level const) to avoid a TDZ in the
    // demo ↔ capabilities ↔ broker import cycle.
    return Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, true]));
  }

  async fieldMap(): Promise<import("./types").BackendFieldMap> {
    // Demo supports everything — except completionPct, which is a rolled-up,
    // read-only value (surface without store) so the surface-vs-store split is
    // visible out of the box.
    const fields = Object.fromEntries(
      FIELD_KEYS.map((f) => [f, { surface: true, store: f !== "completionPct" }]),
    );
    const entities = Object.fromEntries(ENTITY_KEYS.map((e) => [e, { surface: true, store: true }]));
    return { fields, entities };
  }

  async describeFields(): Promise<import("../lib/field-registry").EnumeratedField[]> {
    // The demo "backend" exposes the canonical registry PLUS a couple of
    // tenant/custom fields the registry doesn't model — so the describe →
    // reconcile path has something to discover and surface as gated passthrough.
    // Each field carries the backend's NATIVE field name (illustrative Jira ids),
    // so the overlay can show granular lineage: "dueDate ← jira:duedate". A real
    // workflow supplies the true mapping; here it's representative sample data.
    const { FIELD_REGISTRY } = await import("../lib/field-registry");
    // The system label is data-driven (the configured backend), not hardcoded —
    // a real broker reports its own. "all"/"none" fall back to a neutral label.
    const bs = getSettings().backendSource;
    const system = bs && bs !== "all" && bs !== "none" ? bs : "backend";
    const canonical = FIELD_REGISTRY.map((f) => ({
      key: f.key, label: f.label, type: f.type, surface: true, store: true,
      sourceSystem: system, sourceField: SAMPLE_NATIVE_FIELDS[f.key] ?? f.key,
    }));
    const custom = [
      { key: "customerTier", label: "Customer tier", type: "string", surface: true, store: false, sourceSystem: system, sourceField: "customfield_10200" },
      { key: "riskScore", label: "Risk score", type: "number", surface: true, store: false, sourceSystem: system, sourceField: "customfield_10201" },
    ];
    return [...canonical, ...custom];
  }

  async fxRates(_ctx: ActorContext, opts?: { asOf?: string }): Promise<FxRates> {
    // The demo table has no real history, so it can't serve a genuinely different rate for a past
    // date — it degrades to the same indicative table but is honest about which date it's stamped
    // with, so the period-close / budget-rate policies still show a coherent "as of" in the UI.
    return opts?.asOf ? { ...DEMO_FX, asOf: opts.asOf } : DEMO_FX;
  }

  async replay(): Promise<HistoryState[]> {
    // No logging server in demo mode — synthesise a short ramp toward the current
    // portfolio completion so the time-travel UI has something to scrub, clearly
    // badged `sample` (never presented as recorded fact).
    const total = SAMPLE_PROJECTS.reduce((s, p) => s + (Number(p["issueCount"]) || 0), 0);
    const done = SAMPLE_PROJECTS.reduce((s, p) => s + (Number(p["completedCount"]) || 0), 0);
    const current = total > 0 ? Math.round((done / total) * 100) : 0;
    const POINTS = 6;
    return Array.from({ length: POINTS }, (_, i) => {
      const at = new Date(Date.UTC(2026, i, 1)).toISOString();
      return {
        at,
        completionPct: Math.round((current * (i + 1)) / POINTS),
        openBlockers: Math.max(0, 5 - i),
        provenance: "sample" as const,
      };
    });
  }

  async changeToken(_ctx: ActorContext, resource: string): Promise<string | null> {
    // A cheap version of a resource slice, so the gateway can serve 304 for an
    // unchanged read. Volatile resources (activity/fx/notifications carry timestamps)
    // return null so they fall back to the payload hash. A real broker maps this to a
    // backend ETag / max(updatedAt).
    const hash = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v) ?? "").digest("base64url");
    if (resource === "projects") return hash(SAMPLE_PROJECTS);
    if (resource.startsWith("issues:")) return hash(SAMPLE_ISSUES[resource.slice("issues:".length)] ?? []);
    if (resource.startsWith("raid:")) return hash(SAMPLE_RAID[resource.slice("raid:".length)] ?? []);
    return null;
  }

  async verifyConnection(_ctx: ActorContext, backend: string): Promise<{ ok: boolean; detail?: string }> {
    // Demo: there's no real backend to reach, so report a clearly-labelled success.
    return { ok: true, detail: `demo broker (no real ${backend} connection)` };
  }

  async storeCredential(_ctx: ActorContext, input: { backend: string; name: string; value: string }): Promise<{ stored: boolean; ref?: string }> {
    // Demo: acknowledge WITHOUT keeping the value (no vault) — a real broker (n8n)
    // writes it to its encrypted credential store and returns the real reference.
    return { stored: true, ref: `demo:${input.backend}/${input.name}` };
  }

  async verify(): Promise<VerifyReport> {
    return { ok: true, actions: [] };
  }
}
