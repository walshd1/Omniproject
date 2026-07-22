import type { Project, Issue, ProjectWrite, IssueWrite, Row, Task, TaskWrite, Whiteboard } from "../types";
import { isDone, isTaskClosed } from "../vocabulary";
import type { BuiltinStore } from "./store";
import { decodeKey32 } from "../../lib/crypto-keys";
import { OmniEventLog, resolveStoreKey, deriveKeys, type OmniLink } from "./omnistore-log";

/**
 * OmniStore — the first-party, STATEFUL system-of-record store (the one exception to the stateless
 * rule, below the broker seam). It implements the same `BuiltinStore` contract as `MemoryStore`, so it
 * drops into `BuiltinBroker` and passes the same conformance suite — but its state is a deterministic
 * PROJECTION (pure fold) of an append-only, hash-chained, encrypted event log (`omnistore-log`):
 *
 *  - Encrypted + provably immutable except via valid calls — see the log module.
 *  - Self-contained + portable — the store owns its key; `exportBundle()`/`importBundle()` move the
 *    whole store (sealed log + the root key that is its identity) between OmniProject instances,
 *    re-verifying the chain on arrival.
 *
 * Determinism: ids + timestamps are assigned at write time and STORED in the event, so a replay
 * rebuilds byte-identical state (no Date.now/random during replay). `actor` is null here — the gateway
 * records WHO per call in its broker audit; this log proves WHAT changed and that it wasn't tampered.
 */

interface Seq { project: number; issue: number; raid: number; task: number }
interface OmniState {
  projects: Map<string, Project>;
  issues: Map<string, Issue[]>;
  raid: Map<string, Row[]>;
  tasks: Map<string, Task>;
  whiteboards: Map<string, Whiteboard>;
  seq: Seq;
}
const emptyState = (): OmniState => ({ projects: new Map(), issues: new Map(), raid: new Map(), tasks: new Map(), whiteboards: new Map(), seq: { project: 0, issue: 0, raid: 0, task: 0 } });

/** Drop `undefined` fields so a patch only overwrites what it explicitly sets (mirrors MemoryStore). */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Trailing integer of an `id` like "proj-7" (0 when none) — keeps the per-kind counter ahead of any
 *  id seen during replay, so freshly-minted ids never collide. */
function idNum(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Recompute a project's denormalised issue/complete counts from its issues. */
function recount(state: OmniState, projectId: string): void {
  const p = state.projects.get(projectId);
  if (!p) return;
  const list = state.issues.get(projectId) ?? [];
  p.issueCount = list.length;
  p.completedCount = list.filter((i) => isDone(String(i.status))).length;
}

/**
 * THE reducer — apply one log link to the state. Used identically for live appends and full replay,
 * so "what a write does" and "what a load rebuilds" can never diverge. Deterministic: it only reads
 * values already in the event.
 */
export function applyEvent(state: OmniState, link: OmniLink): void {
  const p = link.payload;
  switch (link.action) {
    case "project.create": {
      const project = p["project"] as Project;
      state.projects.set(project.id, { ...project });
      if (!state.issues.has(project.id)) state.issues.set(project.id, []);
      state.seq.project = Math.max(state.seq.project, idNum(project.id));
      return;
    }
    case "project.update": {
      const proj = state.projects.get(p["id"] as string);
      if (proj) Object.assign(proj, definedOnly(p["patch"] as object));
      return;
    }
    case "issue.create": {
      const issue = p["issue"] as Issue;
      const list = state.issues.get(issue.projectId) ?? [];
      list.push({ ...issue });
      state.issues.set(issue.projectId, list);
      state.seq.issue = Math.max(state.seq.issue, idNum(issue.id));
      recount(state, issue.projectId);
      return;
    }
    case "issue.update": {
      const list = state.issues.get(p["projectId"] as string) ?? [];
      const issue = list.find((x) => x.id === p["issueId"]);
      if (issue) Object.assign(issue, definedOnly(p["patch"] as object));
      recount(state, p["projectId"] as string);
      return;
    }
    case "issue.delete": {
      const list = state.issues.get(p["projectId"] as string) ?? [];
      const idx = list.findIndex((x) => x.id === p["issueId"]);
      if (idx !== -1) list.splice(idx, 1);
      recount(state, p["projectId"] as string);
      return;
    }
    case "raid.add": {
      const row = p["row"] as Row;
      const list = state.raid.get(row["projectId"] as string) ?? [];
      list.push({ ...row });
      state.raid.set(row["projectId"] as string, list);
      state.seq.raid = Math.max(state.seq.raid, idNum(String(row["id"])));
      return;
    }
    case "task.create": {
      const task = p["task"] as Task;
      state.tasks.set(task.id, { ...task });
      state.seq.task = Math.max(state.seq.task, idNum(task.id));
      return;
    }
    case "task.update": {
      const task = state.tasks.get(p["id"] as string);
      if (task) Object.assign(task, definedOnly(p["patch"] as object));
      return;
    }
    case "whiteboard.save": {
      // Upsert the whole board (the broker set id/owner/timestamps before committing) — the id is stored
      // in the event, so a replay rebuilds identical state.
      const board = p["board"] as Whiteboard;
      state.whiteboards.set(board.id, { ...board });
      return;
    }
    case "whiteboard.delete": {
      state.whiteboards.delete(p["id"] as string);
      return;
    }
  }
}

export class OmniStore implements BuiltinStore {
  readonly name = "omnistore";
  /** OmniStore HOMES any orphaned data (it persists the whole row for any vendor shape), so the built-in
   *  broker offers the full capability superset over it — a sole OmniStore backend covers 100% of the data. */
  readonly homesOrphans = true;
  private readonly root: Buffer;
  private readonly log: OmniEventLog;
  private readonly state: OmniState = emptyState();
  /** Durability hook: given the freshly-sealed log after each write, persist it (e.g. write-through to
   *  a file). Kept OUT of the store so the core stays fs-free + testable; the wiring supplies the I/O. */
  private readonly onCommit: ((sealed: string) => void) | undefined;

  constructor(root: Buffer = resolveStoreKey(), log?: OmniEventLog, onCommit?: (sealed: string) => void) {
    this.root = root;
    this.log = log ?? new OmniEventLog(deriveKeys(root));
    this.onCommit = onCommit;
    for (const link of this.log.entries()) applyEvent(this.state, link);
  }

  /** Commit one mutation: append the (resolved) event, apply it to the live projection, then persist.
   *  The append is the ONLY way state changes — reads never mutate. */
  private commit(action: string, payload: Record<string, unknown>): void {
    const link = this.log.append(action, null, payload, new Date().toISOString());
    applyEvent(this.state, link);
    this.onCommit?.(this.log.sealed()); // write-through: durable + tamper-evident at rest
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  async listProjects(): Promise<Project[]> {
    return [...this.state.projects.values()].map((p) => ({ ...p }));
  }
  async getProject(id: string): Promise<Project | null> {
    const p = this.state.projects.get(id);
    return p ? { ...p } : null;
  }
  async createProject(input: ProjectWrite): Promise<Project> {
    const id = `proj-${this.state.seq.project + 1}`;
    const project: Project = {
      id,
      name: input.name ?? "Untitled project",
      identifier: input.identifier ?? null,
      description: input.description ?? null,
      programmeId: input.programmeId ?? null,
      source: "omnistore",
      ...(input.omniInstanceId ? { omniInstanceId: input.omniInstanceId } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      issueCount: 0,
      completedCount: 0,
    };
    this.commit("project.create", { project });
    return { ...project };
  }
  async updateProject(id: string, input: ProjectWrite): Promise<Project | null> {
    if (!this.state.projects.has(id)) return null;
    const patch = definedOnly({ name: input.name, identifier: input.identifier, description: input.description, programmeId: input.programmeId, status: input.status });
    this.commit("project.update", { id, patch });
    const p = this.state.projects.get(id)!;
    return { ...p };
  }

  // ── Issues ────────────────────────────────────────────────────────────────
  async listIssues(projectId: string): Promise<Issue[]> {
    return (this.state.issues.get(projectId) ?? []).map((i) => ({ ...i }));
  }
  async getIssue(projectId: string, issueId: string): Promise<Issue | null> {
    const i = (this.state.issues.get(projectId) ?? []).find((x) => x.id === issueId);
    return i ? { ...i } : null;
  }
  async createIssue(input: IssueWrite): Promise<Issue> {
    const issue: Issue = {
      id: `issue-${this.state.seq.issue + 1}`,
      projectId: input.projectId,
      title: input.title ?? "Untitled",
      status: input.status ?? "todo",
      version: 1,
      ...definedOnly({ priority: input.priority, assignee: input.assignee, labels: input.labels, description: input.description }),
    };
    this.commit("issue.create", { issue });
    return { ...issue };
  }
  async updateIssue(input: IssueWrite): Promise<Issue | { conflict: number } | null> {
    const list = this.state.issues.get(input.projectId) ?? [];
    const issue = list.find((x) => x.id === input.issueId);
    if (!issue) return null;
    const current = issue.version ?? 1;
    if (input.expectedVersion != null && input.expectedVersion !== current) return { conflict: current };
    const { projectId: _p, issueId: _i, expectedVersion: _v, ...rest } = input;
    const patch = { ...definedOnly(rest), version: current + 1 };
    this.commit("issue.update", { projectId: input.projectId, issueId: input.issueId, patch });
    const updated = list.find((x) => x.id === input.issueId)!;
    return { ...updated };
  }
  async deleteIssue(projectId: string, issueId: string): Promise<boolean> {
    const list = this.state.issues.get(projectId) ?? [];
    if (!list.some((x) => x.id === issueId)) return false;
    this.commit("issue.delete", { projectId, issueId });
    return true;
  }

  // ── RAID ──────────────────────────────────────────────────────────────────
  async listRaid(projectId: string): Promise<Row[]> {
    return (this.state.raid.get(projectId) ?? []).map((r) => ({ ...r }));
  }
  async addRaid(projectId: string, entry: Record<string, unknown>): Promise<Row> {
    const row: Row = { id: `raid-${this.state.seq.raid + 1}`, projectId, provenance: "sourced", ...entry };
    this.commit("raid.add", { row });
    return { ...row };
  }

  // ── GTD tasks ─────────────────────────────────────────────────────────────
  async listTasks(opts: { projectId?: string }): Promise<Task[]> {
    const all = [...this.state.tasks.values()].map((t) => ({ ...t }));
    return opts.projectId ? all.filter((t) => t.projectId === opts.projectId) : all;
  }
  async getTask(taskId: string): Promise<Task | null> {
    const t = this.state.tasks.get(taskId);
    return t ? { ...t } : null;
  }
  async createTask(input: TaskWrite): Promise<Task> {
    const task: Task = {
      id: `task-${this.state.seq.task + 1}`,
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
      source: "omnistore",
    };
    this.commit("task.create", { task });
    return { ...task };
  }
  async updateTask(taskId: string, input: TaskWrite): Promise<Task | null> {
    if (!this.state.tasks.has(taskId)) return null;
    const patch: Record<string, unknown> = { ...definedOnly(input as object) };
    // Stamp/clear completion when status crosses the done line, unless the caller set it explicitly.
    if (input.status !== undefined && input.completedAt === undefined) {
      patch["completedAt"] = isTaskClosed(input.status) ? new Date().toISOString() : null;
    }
    this.commit("task.update", { id: taskId, patch });
    const t = this.state.tasks.get(taskId)!;
    return { ...t };
  }

  // ── Whiteboards ───────────────────────────────────────────────────────────
  async listWhiteboards(): Promise<Whiteboard[]> {
    return [...this.state.whiteboards.values()].map((b) => ({ ...b }));
  }
  async getWhiteboard(id: string): Promise<Whiteboard | null> {
    const b = this.state.whiteboards.get(id);
    return b ? { ...b } : null;
  }
  async saveWhiteboard(board: Whiteboard): Promise<void> {
    this.commit("whiteboard.save", { board });
  }
  async deleteWhiteboard(id: string): Promise<boolean> {
    if (!this.state.whiteboards.has(id)) return false;
    this.commit("whiteboard.delete", { id });
    return true;
  }

  // ── Integrity + portability (the OmniStore-specific surface) ────────────────
  /** Prove the log hasn't been tampered with (append-only chain intact). */
  verifyIntegrity(): ReturnType<OmniEventLog["verify"]> {
    return this.log.verify();
  }

  /** Seal the whole store to an encrypted token for at-rest persistence (opens under the same key). */
  sealed(): string {
    return this.log.sealed();
  }

  /** Load a locally-sealed store (decrypt + verify chain under `root`), optionally re-attaching a
   *  durability hook so continued writes persist. */
  static openSealed(token: string, root: Buffer = resolveStoreKey(), onCommit?: (sealed: string) => void): OmniStore {
    return new OmniStore(root, OmniEventLog.openSealed(token, deriveKeys(root)), onCommit);
  }

  /**
   * Portable export for moving the store BETWEEN OmniProject instances: the sealed (encrypted) log
   * plus the ROOT KEY that is the store's identity (the keyed chain can only be verified under it).
   * Carry BOTH to the target's {@link importBundle}. (If both instances already share `OMNISTORE_KEY`,
   * move only `bundle` — the target derives the same root.)
   */
  exportBundle(): { bundle: string; rootKey: string } {
    return { bundle: this.log.sealed(), rootKey: this.root.toString("base64") };
  }

  /** Adopt a portable bundle on another instance: decrypt with the travelling root key, verify the
   *  chain, and run as a local store keyed by that root. */
  static importBundle(bundle: string, rootKey: string): OmniStore {
    const root = decodeKey32(rootKey);
    if (!root) throw new Error("omnistore: root key must be base64, 32 bytes");
    return new OmniStore(root, OmniEventLog.openSealed(bundle, deriveKeys(root)));
  }
}
