import { getSettings } from "../lib/settings";
import { versionConflict } from "../lib/concurrency";
import { CAPABILITY_DOMAINS, FIELD_KEYS, ENTITY_KEYS } from "../lib/capabilities";
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

/**
 * Recompute a project row's denormalised issueCount/completedCount from its
 * actual issues after a mutation, mirroring the initial-seed reconcile in
 * demo-data. The project card reads these counts for its completion %, so they
 * must move when an issue is created/deleted OR when a status crosses done —
 * otherwise the card drifts from the board and the (always-recomputed) summary.
 * "Completed" matches the summary definition (status === "done").
 */
function recountProject(projectId: string): void {
  const proj = SAMPLE_PROJECTS.find((p) => p["id"] === projectId);
  if (!proj) return;
  const issues = SAMPLE_ISSUES[projectId] ?? [];
  proj["issueCount"] = issues.length;
  proj["completedCount"] = issues.filter((i) => (i as { status?: string }).status === "done").length;
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
        source: backend === "openproject" ? "openproject" : "plane",
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
      if (issue.dueDate && new Date(issue.dueDate) < now && issue.status !== "done" && issue.status !== "cancelled") overdue++;
    }
    const total = issues.length;
    const completionRate = total > 0 ? Math.round(((byStatus["done"] ?? 0) / total) * 100) : 0;
    return { projectId, total, byStatus, byPriority, completionRate, overdue };
  }

  async projectHistory(_ctx: ActorContext, projectId: string): Promise<HistoryPoint[]> {
    const issues = (SAMPLE_ISSUES[projectId] ?? []) as Array<{ status: string }>;
    const total = issues.length;
    const done = issues.filter((i) => i.status === "done").length;
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

  async fxRates(): Promise<FxRates> {
    return DEMO_FX;
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

  async verify(): Promise<VerifyReport> {
    return { ok: true, actions: [] };
  }
}
