import {
  BrokerError,
  type Broker,
  type ActorContext,
  type Project,
  type Issue,
  type IssueWrite,
  type ProjectWrite,
  type ProjectMember,
  type Task,
  type TaskWrite,
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
  type Whiteboard,
  type WhiteboardWrite,
} from "../types";
import crypto from "node:crypto";
import { isDone, isClosed } from "../vocabulary";
import { INDICATIVE_FX_RATES } from "../../lib/fx-fallback";
import { inScope } from "../../lib/scope";
import { programmeIdsOf } from "../../lib/programmes";
import { getSettings } from "../../lib/settings";
import { whiteboardVisibleTo, newWhiteboardRow, mergeWhiteboardUpdate } from "../whiteboard-ownership";
import { omnistoreSupersetCapabilities } from "../../lib/omnistore-homing";
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

  // Whiteboards — capability-gated on the STORE: exposed only when the store can persist scenes (memory +
  // omnistore do; the SQL sidecar doesn't), so a store that can't persist leaves these undefined and the
  // routes answer 501. Ownership (org-wide vs personal) is enforced HERE via the shared, pure rules.
  listWhiteboards?: (ctx: ActorContext, opts?: { projectId?: string }) => Promise<Whiteboard[]>;
  getWhiteboard?: (ctx: ActorContext, id: string) => Promise<Whiteboard | null>;
  writeWhiteboard?: (ctx: ActorContext, op: "create" | "update" | "delete", input: WhiteboardWrite & { id?: string }) => Promise<Whiteboard | null>;

  constructor(private readonly store: BuiltinStore) {
    this.kind = `builtin:${store.name}`;
    if (store.saveWhiteboard && store.listWhiteboards && store.getWhiteboard && store.deleteWhiteboard) {
      this.listWhiteboards = async (ctx, opts) => {
        const all = await store.listWhiteboards!();
        return all
          .filter((b) => (!opts?.projectId || b.projectId === opts.projectId) && whiteboardVisibleTo(b, ctx.sub))
          .map((b) => ({ ...b, scene: { elements: [] } })); // list omits the scene body
      };
      this.getWhiteboard = async (ctx, id) => {
        const b = await store.getWhiteboard!(id);
        return b && whiteboardVisibleTo(b, ctx.sub) ? b : null; // a personal board is null to non-owners
      };
      this.writeWhiteboard = async (ctx, op, input) => {
        const now = new Date().toISOString();
        if (op === "create") {
          const row = newWhiteboardRow(ctx, `wb-${crypto.randomUUID()}`, input, now);
          await store.saveWhiteboard!(row);
          return row;
        }
        // update / delete: the board must exist AND be visible to the caller (a personal board is
        // not_found to a non-owner, so neither edit nor delete can target it).
        const existing = input.id ? await store.getWhiteboard!(input.id) : null;
        if (!existing || !whiteboardVisibleTo(existing, ctx.sub)) throw new BrokerError("not_found", "Whiteboard not found");
        if (op === "delete") { await store.deleteWhiteboard!(existing.id); return null; }
        const merged = mergeWhiteboardUpdate(existing, ctx, input, now);
        await store.saveWhiteboard!(merged);
        return merged;
      };
    }
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  /** Reference scope enforcement for the visible-project set: `listProjects` (and the portfolio
   *  roll-up that derives from it) is the scope-filtered set per the broker contract
   *  (lib/project-scope), so a programme-scoped principal — a human manager OR a scoped API token —
   *  only ever sees its own programmes' projects. Mirrors DemoBroker.listProjects; without it the
   *  built-in (real, durable) store returned the WHOLE portfolio to any caller. */
  private scopeProjects(ctx: ActorContext | undefined, projects: Project[]): Project[] {
    const scope = ctx?.scope ?? { level: "all" as const };
    if (scope.level === "all") return projects;
    const registry = getSettings().programmeRegistry;
    return projects.filter((p) =>
      inScope(scope, { id: (p as Row)["id"] as string, programmeId: ((p as Row)["programmeId"] as string | null | undefined) ?? null, programmeIds: programmeIdsOf(p as Row, registry) }),
    );
  }

  async listProjects(ctx?: ActorContext): Promise<Project[]> {
    return this.scopeProjects(ctx, await this.store.listProjects());
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
  async portfolioHealth(ctx: ActorContext): Promise<PortfolioRow[]> {
    const projects = this.scopeProjects(ctx, await this.store.listProjects());
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

  // ── GTD tasks — the built-in store models them, so the self-host broker is a first-class task backend ──
  async listTasks(_ctx: ActorContext, opts: { projectId?: string } = {}): Promise<Task[]> {
    return this.store.listTasks(opts);
  }
  async getTask(_ctx: ActorContext, taskId: string): Promise<Task | null> {
    return this.store.getTask(taskId);
  }
  async createTask(_ctx: ActorContext, input: TaskWrite): Promise<Task> {
    return this.store.createTask(input);
  }
  async updateTask(_ctx: ActorContext, taskId: string, input: TaskWrite): Promise<Task> {
    const updated = await this.store.updateTask(taskId, input);
    if (!updated) throw new BrokerError("not_found", "Task not found");
    return updated;
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
    // A SoR-of-last-resort store (OmniStore) HOMES any orphaned data — it persists the whole row for any
    // vendor shape — so a domain whose data it homes is one it can honestly serve. It therefore offers the
    // full capability superset; when it is the sole backend that is 100% of the data. (Roll-ups a Phase-1
    // store doesn't compute still return honest empties; the raw fields round-trip, which the flag gates.)
    if (this.store.homesOrphans) return omnistoreSupersetCapabilities();
    // Otherwise: what a small first-party store genuinely serves — work items + their scheduling, RAID, and
    // the derived portfolio roll-up. The enterprise tail (financials, resources, baselines, history,
    // blockers, and the superset domains) is honestly OFF — it carries no such data.
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
