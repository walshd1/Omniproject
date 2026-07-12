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
} from "../types";
import { isDone, isClosed } from "../vocabulary";
import { INDICATIVE_FX_RATES } from "../../lib/fx-fallback";
import type { BuiltinStore } from "./store";

/**
 * BUILT-IN BROKER — an in-process implementation of the `Broker` interface backed by a pluggable
 * store (`BuiltinStore`): `MemoryStore` for tests/ephemeral use, a Postgres store for a durable,
 * customer-owned system of record. Everything above the seam sees an ordinary `Broker`, exactly
 * like the n8n / demo adapters — so a tiny org with no external backend can run OmniProject
 * standalone WITHOUT the core knowing or caring where the data lives.
 *
 * It is a REAL backend (`live = true`): unlike the demo adapter it serves no sample data and starts
 * empty. Domains a small first-party store genuinely doesn't have (financials, resource capacity,
 * cross-org portfolio) return honest empties rather than invented numbers — the same
 * capability-honest posture every broker follows.
 */
export class BuiltinBroker implements Broker {
  readonly kind: string;
  readonly live = true;

  constructor(private readonly store: BuiltinStore) {
    this.kind = `builtin:${store.name}`;
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  async listProjects(_ctx?: ActorContext): Promise<Project[]> {
    return this.store.listProjects();
  }
  async createProject(_ctx: ActorContext, input: ProjectWrite): Promise<Project> {
    return this.store.createProject(input);
  }
  async updateProject(_ctx: ActorContext, projectId: string, input: ProjectWrite): Promise<Project> {
    const updated = await this.store.updateProject(projectId, input);
    if (!updated) throw new BrokerError("not_found", "Project not found");
    return updated;
  }

  // ── Issues ──────────────────────────────────────────────────────────────────
  async listIssues(_ctx: ActorContext, projectId: string): Promise<Issue[]> {
    return this.store.listIssues(projectId);
  }
  async getIssue(_ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null> {
    return this.store.getIssue(projectId, issueId);
  }
  async writeIssue(_ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null> {
    if (op === "create") return this.store.createIssue(input);
    if (op === "delete") {
      const ok = await this.store.deleteIssue(input.projectId, input.issueId ?? "");
      if (!ok) throw new BrokerError("not_found", "Issue not found");
      return null;
    }
    const result = await this.store.updateIssue(input);
    if (result === null) throw new BrokerError("not_found", "Issue not found");
    if ("conflict" in result) throw new BrokerError("conflict", "Issue was modified by someone else", { version: result.conflict });
    return result;
  }

  // ── RAID ──────────────────────────────────────────────────────────────────────
  async listRaid(_ctx: ActorContext, projectId: string): Promise<Row[]> {
    return this.store.listRaid(projectId);
  }
  async addRaid(_ctx: ActorContext, projectId: string, body: Record<string, unknown>): Promise<Row> {
    return this.store.addRaid(projectId, body);
  }

  // ── Derived read model ─────────────────────────────────────────────────────────
  async projectSummary(_ctx: ActorContext, projectId: string): Promise<Summary> {
    const issues = await this.store.listIssues(projectId);
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let overdue = 0;
    const now = new Date();
    for (const i of issues) {
      const status = String(i.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const priority = String((i as Row)["priority"] ?? "none");
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;
      const due = (i as Row)["dueDate"];
      if (typeof due === "string" && new Date(due) < now && !isClosed(status)) overdue++;
    }
    const total = issues.length;
    const done = issues.filter((i) => isDone(String(i.status))).length;
    return { projectId, total, byStatus, byPriority, completionRate: total > 0 ? Math.round((done / total) * 100) : 0, overdue };
  }
  async portfolioHealth(_ctx: ActorContext): Promise<PortfolioRow[]> {
    const projects = await this.store.listProjects();
    return projects.map((p) => {
      const issueCount = Number((p as Row)["issueCount"] ?? 0);
      const completed = Number((p as Row)["completedCount"] ?? 0);
      const rate = issueCount > 0 ? Math.round((completed / issueCount) * 100) : 0;
      // RAG from completion (the built-in store carries no schedule/budget baseline, so those
      // variances are 0 and blocker tracking is off — honest, not invented).
      return {
        projectId: p.id, projectName: p.name,
        ragStatus: rate >= 80 ? "green" : rate >= 40 ? "amber" : "red",
        scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0,
      };
    });
  }

  // ── Honest empties: a small first-party store carries none of these (capability-gated off) ──────
  async projectMembers(): Promise<ProjectMember[]> { return []; }
  async listTaskItems(): Promise<TaskItem[]> { return []; }
  async createTaskItem(_ctx: ActorContext, _projectId: string, taskId: string, input: TaskItemWrite): Promise<TaskItem> {
    return { id: `ti-${taskId}-${input.kind}`, taskId, kind: input.kind, content: input.content, author: null, createdAt: "" };
  }
  async listActivity(): Promise<Row[]> { return []; }
  async projectHistory(): Promise<HistoryPoint[]> { return []; }
  async baseline(): Promise<Baseline | null> { return null; }
  async notifications(): Promise<Row[]> { return []; }
  async resourceCapacity(): Promise<Row[]> { return []; }
  async projectFinancials(_ctx: ActorContext, projectId: string): Promise<Row> {
    return { projectId, provenance: "sourced", currency: null, budget: null, actualCost: null };
  }
  async replay(): Promise<HistoryState[]> { return []; }

  async fxRates(_ctx: ActorContext, _opts?: { asOf?: string }): Promise<FxRates> {
    return INDICATIVE_FX_RATES;
  }
  async capabilities(): Promise<CapabilityFlags> {
    // What a built-in store genuinely serves: work items + their scheduling, RAID, and the derived
    // portfolio roll-up. The enterprise tail (financials, resources, baselines, history, blockers,
    // and the superset domains) is honestly OFF — it carries no such data.
    return {
      issues: true, scheduling: true, portfolio: true, raid: true,
      resources: false, financials: false, baseline: false, blockers: false, history: false,
      quality: false, crm: false, service: false,
    };
  }
  async verify(): Promise<VerifyReport> {
    return { ok: true, actions: [] };
  }
}
