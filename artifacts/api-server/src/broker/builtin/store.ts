import type { Project, Issue, ProjectWrite, IssueWrite, Row, Task, TaskWrite } from "../types";
import { isDone, isTaskClosed } from "../vocabulary";

/**
 * The BUILT-IN BROKER's storage seam.
 *
 * The built-in broker (see ./builtin-broker.ts) is an in-process implementation of the `Broker`
 * interface — it talks to ANY backing store through this small async CRUD contract. Swap the store,
 * keep the broker:
 *   - `MemoryStore` (here): zero-dependency, non-persistent — for tests and ephemeral use.
 *   - `PostgresStore` (follow-up): the same contract over `@workspace/db` — a real, durable,
 *     customer-owned system of record.
 *
 * Async throughout so a SQL store drops in unchanged. Optimistic concurrency on issue updates
 * mirrors the broker contract (`expectedVersion` → conflict).
 */
export interface BuiltinStore {
  /** A short label for diagnostics (e.g. "memory", "postgres"). */
  readonly name: string;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: ProjectWrite): Promise<Project>;
  updateProject(id: string, input: ProjectWrite): Promise<Project | null>;
  listIssues(projectId: string): Promise<Issue[]>;
  getIssue(projectId: string, issueId: string): Promise<Issue | null>;
  createIssue(input: IssueWrite): Promise<Issue>;
  /** Update an issue. Returns `{ conflict: currentVersion }` when `expectedVersion` is stale,
   *  `null` when the issue is missing, else the updated issue. */
  updateIssue(input: IssueWrite): Promise<Issue | { conflict: number } | null>;
  deleteIssue(projectId: string, issueId: string): Promise<boolean>;
  listRaid(projectId: string): Promise<Row[]>;
  addRaid(projectId: string, entry: Record<string, unknown>): Promise<Row>;
  // GTD tasks — actionable next-actions, distinct from issues. Optional on the Broker, but the
  // built-in store models them fully so a self-host deployment is a first-class task backend.
  listTasks(opts: { projectId?: string }): Promise<Task[]>;
  getTask(taskId: string): Promise<Task | null>;
  createTask(input: TaskWrite): Promise<Task>;
  updateTask(taskId: string, input: TaskWrite): Promise<Task | null>;
}

/** Monotonic id helper — deterministic per store instance (no Date.now/random, which are unavailable
 *  in some sandboxes and make tests non-reproducible). */
function makeIdGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Drop `undefined` fields so a patch only overwrites what it explicitly sets. */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * In-memory store — the zero-dependency backing used for tests and ephemeral runs. Holds plain
 * objects; nothing persists across a restart. `PostgresStore` implements the SAME interface for a
 * durable, customer-owned store.
 */
export class MemoryStore implements BuiltinStore {
  readonly name = "memory";
  private projects: Project[] = [];
  private issues = new Map<string, Issue[]>();
  private raid = new Map<string, Row[]>();
  private tasks: Task[] = [];
  private nextProjectId = makeIdGen("proj");
  private nextIssueId = makeIdGen("issue");
  private nextRaidId = makeIdGen("raid");
  private nextTaskId = makeIdGen("task");

  async listProjects(): Promise<Project[]> {
    return this.projects.map((p) => ({ ...p }));
  }
  async getProject(id: string): Promise<Project | null> {
    const p = this.projects.find((x) => x.id === id);
    return p ? { ...p } : null;
  }
  async createProject(input: ProjectWrite): Promise<Project> {
    const project: Project = {
      id: this.nextProjectId(),
      name: input.name ?? "Untitled project",
      identifier: input.identifier ?? null,
      description: input.description ?? null,
      programmeId: input.programmeId ?? null,
      source: "builtin",
      // Store the gateway-minted correlation GUID so it echoes back on reads (see Project.omniInstanceId).
      ...(input.omniInstanceId ? { omniInstanceId: input.omniInstanceId } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      issueCount: 0,
      completedCount: 0,
    };
    this.projects.push(project);
    this.issues.set(project.id, []);
    return { ...project };
  }
  async updateProject(id: string, input: ProjectWrite): Promise<Project | null> {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, definedOnly({ name: input.name, identifier: input.identifier, description: input.description, programmeId: input.programmeId, status: input.status }));
    return { ...p };
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    return (this.issues.get(projectId) ?? []).map((i) => ({ ...i }));
  }
  async getIssue(projectId: string, issueId: string): Promise<Issue | null> {
    const i = (this.issues.get(projectId) ?? []).find((x) => x.id === issueId);
    return i ? { ...i } : null;
  }
  async createIssue(input: IssueWrite): Promise<Issue> {
    const issue: Issue = {
      id: this.nextIssueId(),
      projectId: input.projectId,
      title: input.title ?? "Untitled",
      status: input.status ?? "todo",
      version: 1,
      ...definedOnly({ priority: input.priority, assignee: input.assignee, labels: input.labels, description: input.description }),
    };
    const list = this.issues.get(input.projectId) ?? [];
    list.push(issue);
    this.issues.set(input.projectId, list);
    this.recount(input.projectId);
    return { ...issue };
  }
  async updateIssue(input: IssueWrite): Promise<Issue | { conflict: number } | null> {
    const list = this.issues.get(input.projectId) ?? [];
    const issue = list.find((x) => x.id === input.issueId);
    if (!issue) return null;
    const current = issue.version ?? 1;
    if (input.expectedVersion != null && input.expectedVersion !== current) return { conflict: current };
    const { projectId: _p, issueId: _i, expectedVersion: _v, ...patch } = input;
    Object.assign(issue, definedOnly(patch), { version: current + 1 });
    this.recount(input.projectId);
    return { ...issue };
  }
  async deleteIssue(projectId: string, issueId: string): Promise<boolean> {
    const list = this.issues.get(projectId) ?? [];
    const idx = list.findIndex((x) => x.id === issueId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.recount(projectId);
    return true;
  }

  async listRaid(projectId: string): Promise<Row[]> {
    return (this.raid.get(projectId) ?? []).map((r) => ({ ...r }));
  }
  async addRaid(projectId: string, entry: Record<string, unknown>): Promise<Row> {
    const row: Row = { id: this.nextRaidId(), projectId, provenance: "sourced", ...entry };
    const list = this.raid.get(projectId) ?? [];
    list.push(row);
    this.raid.set(projectId, list);
    return { ...row };
  }

  async listTasks(opts: { projectId?: string }): Promise<Task[]> {
    const all = this.tasks.map((t) => ({ ...t }));
    return opts.projectId ? all.filter((t) => t.projectId === opts.projectId) : all;
  }
  async getTask(taskId: string): Promise<Task | null> {
    const t = this.tasks.find((x) => x.id === taskId);
    return t ? { ...t } : null;
  }
  async createTask(input: TaskWrite): Promise<Task> {
    const task: Task = {
      id: this.nextTaskId(),
      title: input.title ?? "Untitled task",
      status: input.status ?? "next",
      projectId: input.projectId ?? null,
      context: input.context ?? null,
      waitingOn: input.waitingOn ?? null,
      assignee: input.assignee ?? null,
      description: input.description ?? null,
      priority: input.priority ?? "none",
      tags: input.tags ?? [],
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      recurrence: input.recurrence ?? null,
      estimateHours: input.estimateHours ?? null,
      parentTaskId: input.parentTaskId ?? null,
      url: input.url ?? null,
      completedAt: input.completedAt ?? null,
      reminderAt: input.reminderAt ?? null,
      energy: input.energy ?? null,
      section: input.section ?? null,
      sortOrder: input.sortOrder ?? null,
      collaborators: input.collaborators ?? [],
      source: "builtin",
    };
    this.tasks.push(task);
    return { ...task };
  }
  async updateTask(taskId: string, input: TaskWrite): Promise<Task | null> {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return null;
    Object.assign(t, definedOnly(input as object));
    // Stamp/clear completion when status crosses the done line, unless the caller set it explicitly.
    if (input.status !== undefined && input.completedAt === undefined) {
      t.completedAt = isTaskClosed(input.status) ? new Date().toISOString() : null;
    }
    return { ...t };
  }

  /** Keep the project's denormalised issue/complete counts in step with its issues. */
  private recount(projectId: string): void {
    const p = this.projects.find((x) => x.id === projectId);
    if (!p) return;
    const list = this.issues.get(projectId) ?? [];
    p.issueCount = list.length;
    p.completedCount = list.filter((i) => isDone(String(i.status))).length;
  }
}
