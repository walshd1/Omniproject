import crypto from "node:crypto";
import { getSettings } from "../lib/settings";
import { versionConflict } from "../lib/concurrency";
import { CAPABILITY_DOMAINS, FIELD_KEYS, ENTITY_KEYS } from "../lib/capabilities";
import { isDone, isClosed, isTaskClosed } from "./vocabulary";
import { inScope } from "../lib/scope";
import { whiteboardVisibleTo, newWhiteboardRow, mergeWhiteboardUpdate } from "./whiteboard-ownership";
import { programmeIdsOf } from "../lib/programmes";
import {
  SAMPLE_PROJECTS, SAMPLE_ISSUES, SAMPLE_RAID, SAMPLE_CAPACITY, SAMPLE_FINANCIALS,
  SAMPLE_PORTFOLIO, DEMO_FX, sampleActivity, sampleNotifications, persistDemoState,
  resetDemoDataToSeed, shouldAutoResetDemo, demoResetIntervalMinutes,
  SAMPLE_WBS, SAMPLE_WBS_FINANCIALS, SAMPLE_DEPENDENCIES,
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
  type Task,
  type TaskWrite,
  type WbsElement,
  type WbsFinancials,
  type DependencyLink,
  type TaskComment,
  type TaskCommentWrite,
  type TaskAttachment,
  type TaskAttachmentWrite,
  type WikiSpace,
  type WikiDoc,
  type WikiDocWrite,
  type WikiDocVersion,
  type WikiDocVersionMeta,
  type Whiteboard,
  type WhiteboardWrite,
  type Summary,
  type HistoryPoint,
  type HistoryState,
  type Baseline,
  type PortfolioRow,
  type FxRates,
  type CapabilityFlags,
  type VerifyReport,
  type Row,
  type NativeSurface,
  type NativeHandoff,
  type NativeHandoffRequest,
  type NativeImportRequest,
} from "./types";
import { buildVendorUrl, buildEmbedUrl } from "../lib/native-handoff";

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
let taskCounter = 100;
let taskCommentCounter = 100;
let taskAttachmentCounter = 100;
let wikiDocCounter = 100;
/** In-memory task comments + attachments per task (demo only). */
const SAMPLE_TASK_COMMENTS: Record<string, TaskComment[]> = {};
const SAMPLE_TASK_ATTACHMENTS: Record<string, TaskAttachment[]> = {};
/** Demo wiki spaces + documents (the knowledge base the seam proves out). */
const SAMPLE_WIKI_SPACES: WikiSpace[] = [
  { id: "space-eng", key: "eng", name: "Engineering", description: "How the delivery team works." },
  { id: "space-pmo", key: "pmo", name: "PMO", description: "Governance, standards and onboarding." },
];
function seedWikiDocs(): WikiDoc[] {
  return [
    {
      id: "doc-onboarding", spaceId: "space-pmo", parentId: null, slug: "onboarding", title: "Onboarding",
      updatedAt: "2026-07-01T09:00:00.000Z", updatedBy: "grace@demo",
      blocks: [
        { id: "b1", type: "heading", level: 1, text: "Welcome to the PMO" },
        { id: "b2", type: "paragraph", text: "Start with the [[Delivery standards]] then book your intro." },
        { id: "b3", type: "callout", tone: "info", text: "Ask in #pmo if anything is unclear." },
        { id: "b4", type: "checklist", items: [
          { text: "Read the delivery standards", checked: true },
          { text: "Set up your access", checked: false },
        ] },
      ],
    },
    {
      id: "doc-standards", spaceId: "space-pmo", parentId: null, slug: "delivery-standards", title: "Delivery standards",
      updatedAt: "2026-07-02T09:00:00.000Z", updatedBy: "grace@demo",
      blocks: [
        { id: "b1", type: "heading", level: 1, text: "Delivery standards" },
        { id: "b2", type: "paragraph", text: "Every project runs on the overlay; nothing is stored at rest." },
      ],
    },
    {
      // A child page (nested under Onboarding) so the page tree has real hierarchy to render.
      id: "doc-first-week", spaceId: "space-pmo", parentId: "doc-onboarding", slug: "your-first-week", title: "Your first week",
      updatedAt: "2026-07-03T09:00:00.000Z", updatedBy: "grace@demo",
      blocks: [
        { id: "b1", type: "heading", level: 2, text: "Your first week" },
        { id: "b2", type: "paragraph", text: "A day-by-day guide to getting productive on the overlay." },
      ],
    },
  ];
}
let SAMPLE_WIKI_DOCS: WikiDoc[] = seedWikiDocs();
/** Per-document revision history (newest last), captured on every write. Demo-only + RAM-only, bounded so a
 *  long-lived dev session can't grow it without limit. A real backend would keep these in its store. */
let SAMPLE_WIKI_VERSIONS: Record<string, WikiDocVersion[]> = seedWikiVersions();
let wikiVersionCounter = 100;
/** The maximum revisions retained per document (oldest trimmed) — mirrors config-store's bounded ring. */
const MAX_WIKI_VERSIONS = 50;
/** Seed one baseline revision per seeded doc, so the demo history is non-empty from boot. */
function seedWikiVersions(): Record<string, WikiDocVersion[]> {
  const out: Record<string, WikiDocVersion[]> = {};
  for (const d of seedWikiDocs()) {
    out[d.id] = [{
      versionId: `wv-${d.id}-1`, docId: d.id, at: d.updatedAt, author: d.updatedBy ?? null,
      title: d.title, blocks: d.blocks.map((b) => ({ ...b })),
    }];
  }
  return out;
}
/** Append a revision snapshot for a document and trim the ring. Snapshots are deep-copied so later edits to
 *  the live doc can't mutate a stored version. */
function captureWikiVersion(doc: WikiDoc, author: string, at: string): void {
  const list = SAMPLE_WIKI_VERSIONS[doc.id] ?? (SAMPLE_WIKI_VERSIONS[doc.id] = []);
  list.push({
    versionId: `wv-${++wikiVersionCounter}`, docId: doc.id, at, author,
    title: doc.title, blocks: doc.blocks.map((b) => ({ ...b })),
  });
  if (list.length > MAX_WIKI_VERSIONS) list.splice(0, list.length - MAX_WIKI_VERSIONS);
}
/** Demo whiteboards — freeform canvases, scenes stored through the seam (zero-at-rest). RAM-only. */
function seedWhiteboards(): Whiteboard[] {
  return [
    {
      id: "wb-roadmap", name: "Delivery roadmap sketch", projectId: "proj-001",
      ownerSub: "grace@demo", visibility: "org",
      updatedAt: "2026-07-04T09:00:00.000Z", updatedBy: "grace@demo",
      scene: {
        elements: [
          { id: "e1", type: "sticky", x: 40, y: 40, w: 160, h: 120, text: "Cutover plan", color: "blue" },
          { id: "e2", type: "shape", x: 240, y: 60, w: 120, h: 80, shape: "rectangle", text: "Go / no-go" },
          { id: "e3", type: "connector", x: 200, y: 100, x2: 240, y2: 100, from: "e1", to: "e2" },
        ],
        appState: { viewBackgroundColor: "#ffffff" },
      },
    },
  ];
}
let SAMPLE_WHITEBOARDS: Whiteboard[] = seedWhiteboards();
let whiteboardCounter = 100;
/** In-memory child issues/notes per task (demo only). */
const SAMPLE_TASK_ITEMS: Record<string, TaskItem[]> = {};
/** Demo GTD tasks — actionable next-actions across the portfolio, distinct from issues. */
const SAMPLE_TASKS: Task[] = [
  { id: "task-1", title: "Draft the migration cutover plan", status: "next", projectId: "proj-001", context: "@computer", assignee: "pat@demo", priority: "high", tags: ["migration", "planning"], estimateHours: 4, dueDate: null, waitingOn: null, energy: "high", section: "Cutover", sortOrder: 1, collaborators: ["sam@demo"], reminderAt: null, source: "plane" },
  { id: "task-2", title: "Chase vendor for the signed DPA", status: "waiting", projectId: "proj-001", context: "@waiting", waitingOn: "Acme Legal", assignee: "sam@demo", priority: "medium", tags: ["legal", "vendor"], dueDate: null, source: "plane" },
  { id: "task-3", title: "Book the quarterly steering review", status: "scheduled", projectId: null, context: "@calendar", dueDate: "2026-09-01", assignee: "sam@demo", priority: "medium", tags: ["governance"], recurrence: "every 3 months", waitingOn: null, source: "plane" },
  { id: "task-4", title: "Evaluate a second data-residency region", status: "someday", projectId: null, context: "@computer", assignee: null, priority: "low", tags: ["research"], dueDate: null, waitingOn: null, source: "plane" },
];

/** Restore everything DemoBroker can mutate (projects/issues/raid via demo-data,
 *  plus this file's own task-items store and id counters) back to a fresh boot
 *  state. See demo-data's "Periodic reset" section for why this exists. Exported
 *  for tests; the running scheduler below is what fires it in practice. */
export function resetDemoBrokerState(): void {
  resetDemoDataToSeed();
  for (const k of Object.keys(SAMPLE_TASK_ITEMS)) delete SAMPLE_TASK_ITEMS[k];
  SAMPLE_WIKI_DOCS = seedWikiDocs();
  SAMPLE_WIKI_VERSIONS = seedWikiVersions();
  SAMPLE_WHITEBOARDS = seedWhiteboards();
  whiteboardCounter = 100;
  issueCounter = 100;
  raidCounter = 100;
  projectCounter = 100;
  taskItemCounter = 100;
  wikiDocCounter = 100;
  wikiVersionCounter = 100;
}

// Scheduled once per process (guarded below), not per DemoBroker instance —
// tests and the dev broker construct DemoBroker repeatedly, and re-arming a
// timer on every construction would be wasteful (though harmless, since it's
// unref'd and never blocks process exit).
let resetScheduled = false;
function scheduleAutoReset(): void {
  if (resetScheduled || !shouldAutoResetDemo()) return;
  resetScheduled = true;
  const minutes = demoResetIntervalMinutes();
  if (minutes <= 0) return; // DEMO_RESET_MINUTES=0 disables it
  setInterval(resetDemoBrokerState, minutes * 60_000).unref();
}

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

  constructor() {
    scheduleAutoReset();
  }

  async listProjects(ctx?: ActorContext): Promise<Project[]> {
    // Reference enforcement: confirm the forwarded DATA scope and return only in-scope rows.
    // Demo sessions are always scope "all" (no-op here); this demonstrates + tests the contract
    // an external backend (n8n) mirrors off the same forwarded userContext.scope.
    const scope = ctx?.scope ?? { level: "all" as const };
    if (scope.level === "all") return SAMPLE_PROJECTS;
    const registry = getSettings().programmeRegistry;
    return SAMPLE_PROJECTS.filter((p) =>
      inScope(scope, { id: p.id, programmeId: (p["programmeId"] as string | null | undefined) ?? null, programmeIds: programmeIdsOf(p, registry) }),
    );
  }

  async listIssues(_ctx: ActorContext, projectId: string): Promise<Issue[]> {
    return SAMPLE_ISSUES[projectId] ?? [];
  }

  async createProject(_ctx: ActorContext, input: ProjectWrite): Promise<Project> {
    const id = `proj-${++projectCounter}`;
    const project: Project = {
      id,
      name: input.name ?? "Untitled project",
      identifier: input.identifier ?? id.toUpperCase(),
      description: input.description ?? null,
      source: getSettings().backendSource || "plane",
      // Store the gateway-minted correlation GUID so it echoes back on reads (see Project.omniInstanceId).
      ...(input.omniInstanceId ? { omniInstanceId: input.omniInstanceId } : {}),
      status: input.status ?? "active",
      programmeId: input.programmeId ?? null,
      programmeName: null,
      issueCount: 0,
      completedCount: 0,
      memberCount: 1,
      updatedAt: new Date().toISOString(),
    };
    SAMPLE_PROJECTS.push(project);
    persistDemoState();
    return project;
  }

  async updateProject(ctx: ActorContext, projectId: string, input: ProjectWrite): Promise<Project> {
    const proj = SAMPLE_PROJECTS.find((p) => p["id"] === projectId);
    if (!proj) throw new BrokerError("not_found", "Project not found");
    // Reference enforcement: a principal may only mutate a project inside their scope.
    const scope = ctx?.scope ?? { level: "all" as const };
    if (!inScope(scope, { programmeId: (proj["programmeId"] as string | null | undefined) ?? null, programmeIds: programmeIdsOf(proj, getSettings().programmeRegistry) })) {
      throw new BrokerError("unauthorized", "out of scope for this principal");
    }
    if (input.name !== undefined) proj["name"] = input.name;
    if (input.description !== undefined) proj["description"] = input.description;
    if (input.programmeId !== undefined) proj["programmeId"] = input.programmeId;
    if (input.status !== undefined) proj["status"] = input.status;
    proj["updatedAt"] = new Date().toISOString();
    persistDemoState();
    return proj;
  }

  async getIssue(_ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null> {
    return (SAMPLE_ISSUES[projectId] ?? []).find((i) => i.id === issueId) ?? null;
  }

  async writeIssue(_ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null> {
    const { projectId, issueId } = input;
    if (op === "create") {
      const backend = getSettings().backendSource;
      const issue: Issue = {
        id: `iss-${++issueCounter}`,
        projectId,
        title: input.title ?? "Untitled",
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
      return issue;
    }

    const issues = SAMPLE_ISSUES[projectId];
    if (!issues) throw new BrokerError("not_found", "Project not found");

    if (op === "delete") {
      const idx = issues.findIndex((i) => i.id === issueId);
      if (idx !== -1) issues.splice(idx, 1);
      recountProject(projectId);
      persistDemoState();
      return null;
    }

    // update
    const idx = issues.findIndex((i) => i.id === issueId);
    if (idx === -1) throw new BrokerError("not_found", "Issue not found");
    const current = issues[idx]!; // idx proven in-range by the -1 guard above
    const currentVersion = typeof current["version"] === "number" ? (current["version"] as number) : 1;
    if (versionConflict(input.expectedVersion, currentVersion)) {
      throw new BrokerError("conflict", "Issue was modified by someone else", current);
    }
    const { projectId: _p, issueId: _i, expectedVersion: _ev, ...patch } = input;
    // Merge the patch over the current issue. The single `as Issue` is the one assertion the spread
    // needs: IssueWrite's optionals are typed `T | undefined`, which TS won't spread into Issue's
    // exact optionals — but every required field is preserved from `current`, so the result is a
    // valid Issue at runtime (the re-assert of title/status keeps a field-omitting patch honest).
    const updated = {
      ...current, ...patch,
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    } as Issue;
    issues[idx] = updated;
    recountProject(projectId); // a status change to/from "done" moves completedCount
    persistDemoState();
    return updated;
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

  // ── SAP / ERP read models (docs/SAP-CONNECTOR.md §4.6) — fixtures so the connector pipeline is testable
  //    with no SAP tenant. READ-ONLY; the demo broker stands in for an ERP front. ──────────────────────
  async listWbsElements(_ctx: ActorContext, projectId: string): Promise<WbsElement[]> {
    return (SAMPLE_WBS[projectId] ?? []).map((w) => ({ ...w }));
  }

  async getWbsFinancials(_ctx: ActorContext, wbsId: string): Promise<WbsFinancials | null> {
    const f = SAMPLE_WBS_FINANCIALS[wbsId];
    return f ? { ...f } : null;
  }

  // ── Dependency graph (roadmap §5.5) — the demo broker stands in for a SoR that holds issue links. A MUTABLE
  //    per-project edge set so writes/removes round-trip within the session (real backends map to native links).
  private deps: Record<string, DependencyLink[]> = Object.fromEntries(
    Object.entries(SAMPLE_DEPENDENCIES).map(([p, edges]) => [p, edges.map((e) => ({ ...e }))]),
  );
  private static sameEdge(a: DependencyLink, f: string, t: string, k: DependencyLink["kind"]): boolean {
    return a.fromId === f && a.toId === t && a.kind === k;
  }
  async listDependencies(_ctx: ActorContext, projectId: string): Promise<DependencyLink[]> {
    return (this.deps[projectId] ?? []).map((e) => ({ ...e }));
  }
  async writeDependency(_ctx: ActorContext, projectId: string, link: DependencyLink): Promise<DependencyLink> {
    const edges = (this.deps[projectId] ??= []);
    const idx = edges.findIndex((e) => DemoBroker.sameEdge(e, link.fromId, link.toId, link.kind));
    if (idx >= 0) edges[idx] = { ...link }; else edges.push({ ...link }); // idempotent on from·kind·to
    return { ...link };
  }
  async removeDependency(_ctx: ActorContext, projectId: string, fromId: string, toId: string, kind: DependencyLink["kind"]): Promise<void> {
    const edges = this.deps[projectId];
    if (edges) this.deps[projectId] = edges.filter((e) => !DemoBroker.sameEdge(e, fromId, toId, kind));
  }

  // ── Tasks (GTD actionable next-actions) ──────────────────────────────────────
  async listTasks(_ctx: ActorContext, opts: { projectId?: string } = {}): Promise<Task[]> {
    const all = SAMPLE_TASKS.map((t) => ({ ...t }));
    return opts.projectId ? all.filter((t) => t.projectId === opts.projectId) : all;
  }

  async getTask(_ctx: ActorContext, taskId: string): Promise<Task | null> {
    const t = SAMPLE_TASKS.find((x) => x.id === taskId);
    return t ? { ...t } : null;
  }

  async createTask(ctx: ActorContext, input: TaskWrite): Promise<Task> {
    const task: Task = {
      id: `task-${++taskCounter}`,
      title: input.title ?? "Untitled task",
      status: input.status ?? "next",
      projectId: input.projectId ?? null,
      context: input.context ?? null,
      waitingOn: input.waitingOn ?? null,
      assignee: input.assignee ?? ctx.email ?? ctx.name ?? null,
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
      source: getSettings().backendSource || "plane",
    };
    SAMPLE_TASKS.push(task);
    persistDemoState();
    return { ...task };
  }

  async updateTask(_ctx: ActorContext, taskId: string, input: TaskWrite): Promise<Task> {
    const t = SAMPLE_TASKS.find((x) => x.id === taskId);
    if (!t) throw new BrokerError("not_found", "Task not found");
    for (const k of ["title", "status", "projectId", "context", "waitingOn", "assignee", "description", "priority", "tags", "startDate", "dueDate", "recurrence", "estimateHours", "parentTaskId", "url", "completedAt", "reminderAt", "energy", "section", "sortOrder", "collaborators"] as const) {
      if (input[k] !== undefined) (t as Task)[k] = input[k] as never;
    }
    // Stamp/clear completion when the status crosses the done line, if the caller didn't set it.
    if (input.status !== undefined && input.completedAt === undefined) {
      t.completedAt = isTaskClosed(input.status) ? new Date().toISOString() : null;
    }
    persistDemoState();
    return { ...t };
  }

  async listTaskComments(_ctx: ActorContext, taskId: string): Promise<TaskComment[]> {
    return (SAMPLE_TASK_COMMENTS[taskId] ?? []).map((c) => ({ ...c }));
  }

  async addTaskComment(ctx: ActorContext, taskId: string, input: TaskCommentWrite): Promise<TaskComment> {
    if (!SAMPLE_TASKS.some((t) => t.id === taskId)) throw new BrokerError("not_found", "Task not found");
    const comment: TaskComment = {
      id: `tc-${++taskCommentCounter}`,
      taskId,
      body: input.body,
      author: ctx.email ?? ctx.name ?? "demo@local",
      createdAt: new Date().toISOString(),
    };
    (SAMPLE_TASK_COMMENTS[taskId] ??= []).push(comment);
    persistDemoState();
    return { ...comment };
  }

  async listTaskAttachments(_ctx: ActorContext, taskId: string): Promise<TaskAttachment[]> {
    return (SAMPLE_TASK_ATTACHMENTS[taskId] ?? []).map((a) => ({ ...a }));
  }

  async addTaskAttachment(ctx: ActorContext, taskId: string, input: TaskAttachmentWrite): Promise<TaskAttachment> {
    if (!SAMPLE_TASKS.some((t) => t.id === taskId)) throw new BrokerError("not_found", "Task not found");
    const attachment: TaskAttachment = {
      id: `ta-${++taskAttachmentCounter}`,
      taskId,
      filename: input.filename,
      url: input.url ?? null,
      contentType: input.contentType ?? null,
      size: input.size ?? null,
      addedBy: ctx.email ?? ctx.name ?? "demo@local",
      addedAt: new Date().toISOString(),
    };
    (SAMPLE_TASK_ATTACHMENTS[taskId] ??= []).push(attachment);
    persistDemoState();
    return { ...attachment };
  }

  async listWikiSpaces(): Promise<WikiSpace[]> {
    return SAMPLE_WIKI_SPACES.map((s) => ({ ...s }));
  }

  async listWikiDocs(_ctx: ActorContext, opts?: { spaceId?: string }): Promise<WikiDoc[]> {
    const docs = opts?.spaceId ? SAMPLE_WIKI_DOCS.filter((d) => d.spaceId === opts.spaceId) : SAMPLE_WIKI_DOCS;
    // List view: omit the (potentially large) block bodies.
    return docs.map((d) => ({ ...d, blocks: [] }));
  }

  async getWikiDoc(_ctx: ActorContext, id: string): Promise<WikiDoc | null> {
    const doc = SAMPLE_WIKI_DOCS.find((d) => d.id === id);
    return doc ? { ...doc, blocks: doc.blocks.map((b) => ({ ...b })) } : null;
  }

  async writeWikiDoc(ctx: ActorContext, op: "create" | "update" | "delete", input: WikiDocWrite & { id?: string }): Promise<WikiDoc | null> {
    const who = ctx.email ?? ctx.name ?? "demo@local";
    const now = new Date().toISOString();
    if (op === "delete") {
      const before = SAMPLE_WIKI_DOCS.length;
      SAMPLE_WIKI_DOCS = SAMPLE_WIKI_DOCS.filter((d) => d.id !== input.id);
      if (SAMPLE_WIKI_DOCS.length === before) throw new BrokerError("not_found", "Document not found");
      if (input.id) delete SAMPLE_WIKI_VERSIONS[input.id]; // a deleted doc's history goes with it
      persistDemoState();
      return null;
    }
    if (!SAMPLE_WIKI_SPACES.some((s) => s.id === input.spaceId)) throw new BrokerError("not_found", "Space not found");
    if (op === "update") {
      const doc = SAMPLE_WIKI_DOCS.find((d) => d.id === input.id);
      if (!doc) throw new BrokerError("not_found", "Document not found");
      doc.title = input.title;
      doc.blocks = input.blocks;
      doc.spaceId = input.spaceId;
      doc.parentId = input.parentId ?? null;
      if (input.slug) doc.slug = input.slug;
      doc.updatedAt = now;
      doc.updatedBy = who;
      captureWikiVersion(doc, who, now); // snapshot this saved revision into the doc's history
      persistDemoState();
      return { ...doc, blocks: doc.blocks.map((b) => ({ ...b })) };
    }
    const created: WikiDoc = {
      id: `doc-${++wikiDocCounter}`,
      spaceId: input.spaceId,
      parentId: input.parentId ?? null,
      slug: input.slug ?? `doc-${wikiDocCounter}`,
      title: input.title,
      blocks: input.blocks,
      updatedAt: now,
      updatedBy: who,
    };
    SAMPLE_WIKI_DOCS.push(created);
    captureWikiVersion(created, who, now); // the initial revision
    persistDemoState();
    return { ...created, blocks: created.blocks.map((b) => ({ ...b })) };
  }

  async listWikiDocVersions(_ctx: ActorContext, docId: string): Promise<WikiDocVersionMeta[]> {
    const list = SAMPLE_WIKI_VERSIONS[docId] ?? [];
    // Newest first; metadata only (no block bodies) for the history list.
    return list.map((v) => ({ versionId: v.versionId, docId: v.docId, at: v.at, author: v.author ?? null, title: v.title })).reverse();
  }

  async getWikiDocVersion(_ctx: ActorContext, docId: string, versionId: string): Promise<WikiDocVersion | null> {
    const v = (SAMPLE_WIKI_VERSIONS[docId] ?? []).find((x) => x.versionId === versionId);
    return v ? { ...v, blocks: v.blocks.map((b) => ({ ...b })) } : null;
  }

  async listWhiteboards(ctx: ActorContext, opts?: { projectId?: string }): Promise<Whiteboard[]> {
    const boards = SAMPLE_WHITEBOARDS
      .filter((b) => (!opts?.projectId || b.projectId === opts.projectId) && whiteboardVisibleTo(b, ctx.sub));
    // List view: omit the (potentially large) scene bodies.
    return boards.map((b) => ({ ...b, scene: { elements: [] } }));
  }

  async getWhiteboard(ctx: ActorContext, id: string): Promise<Whiteboard | null> {
    const b = SAMPLE_WHITEBOARDS.find((w) => w.id === id);
    if (!b || !whiteboardVisibleTo(b, ctx.sub)) return null; // a personal board is invisible to non-owners
    return { ...b, scene: { elements: [...b.scene.elements], ...(b.scene.appState ? { appState: { ...b.scene.appState } } : {}) } };
  }

  async writeWhiteboard(ctx: ActorContext, op: "create" | "update" | "delete", input: WhiteboardWrite & { id?: string }): Promise<Whiteboard | null> {
    const now = new Date().toISOString();
    if (op === "delete") {
      const board = SAMPLE_WHITEBOARDS.find((w) => w.id === input.id);
      // A personal board is invisible (→ not_found) to a non-owner, so a delete can't target it either.
      if (!board || !whiteboardVisibleTo(board, ctx.sub)) throw new BrokerError("not_found", "Whiteboard not found");
      SAMPLE_WHITEBOARDS = SAMPLE_WHITEBOARDS.filter((w) => w.id !== input.id);
      persistDemoState();
      return null;
    }
    if (op === "update") {
      const idx = SAMPLE_WHITEBOARDS.findIndex((w) => w.id === input.id);
      const board = idx >= 0 ? SAMPLE_WHITEBOARDS[idx]! : undefined;
      if (!board || !whiteboardVisibleTo(board, ctx.sub)) throw new BrokerError("not_found", "Whiteboard not found");
      const merged = mergeWhiteboardUpdate(board, ctx, input, now);
      SAMPLE_WHITEBOARDS[idx] = merged;
      persistDemoState();
      return { ...merged };
    }
    const created = newWhiteboardRow(ctx, `wb-${++whiteboardCounter}`, input, now);
    SAMPLE_WHITEBOARDS.push(created);
    persistDemoState();
    return { ...created };
  }

  async listActivity(): Promise<Row[]> {
    return sampleActivity();
  }

  async projectSummary(_ctx: ActorContext, projectId: string): Promise<Summary> {
    const issues = SAMPLE_ISSUES[projectId] ?? [];
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let overdue = 0;
    const now = new Date();
    for (const issue of issues) {
      // priority/dueDate live on the Row index signature (not the narrow Issue contract); read them as such.
      const priority = String(issue["priority"] ?? "none");
      const dueDate = issue["dueDate"] as string | null | undefined;
      byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;
      if (dueDate && new Date(dueDate) < now && !isClosed(issue.status)) overdue++;
    }
    const total = issues.length;
    const doneCount = issues.filter((i) => isDone(i.status)).length;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    return { projectId, total, byStatus, byPriority, completionRate, overdue };
  }

  async projectHistory(_ctx: ActorContext, projectId: string): Promise<HistoryPoint[]> {
    const issues = SAMPLE_ISSUES[projectId] ?? [];
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
    const issues = SAMPLE_ISSUES[projectId] ?? [];
    // startDate/dueDate live on the Row index signature (not the narrow Issue contract); read them as such.
    const items = issues
      .map((i) => ({ issueId: i.id, title: i.title, plannedStart: (i["startDate"] as string | null) ?? null, plannedFinish: (i["dueDate"] as string | null) ?? null }))
      .filter((i) => i.plannedStart || i.plannedFinish);
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

  async portfolioHealth(ctx?: ActorContext): Promise<PortfolioRow[]> {
    // Mirror listProjects' scope enforcement: the portfolio roll-up exposes per-project id/name/RAG, so a
    // programme-scoped caller must only see its own programmes' rows. Reuse the scope-filtered visible set
    // as the source of truth (a portfolio row is in scope iff its project is a visible project).
    const scope = ctx?.scope ?? { level: "all" as const };
    if (scope.level === "all") return SAMPLE_PORTFOLIO;
    const visibleIds = new Set((await this.listProjects(ctx)).map((p) => p.id));
    return SAMPLE_PORTFOLIO.filter((r) => visibleIds.has(String(r.projectId)));
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
      // Illustrative advertised constraints (a real broker reports its own): text fields cap length, enums
      // carry their options, so a linked UI field inherits the backend's own validation.
      ...(f.type === "string" ? { maxLength: 255 } : {}),
      ...(f.type === "text" ? { maxLength: 32000 } : {}),
      ...(f.type === "currency" || f.type === "percent" ? { precision: 2 } : {}),
    }));
    const custom = [
      { key: "customerTier", label: "Customer tier", type: "enum", surface: true, store: false, sourceSystem: system, sourceField: "customfield_10200", options: ["bronze", "silver", "gold"], nullable: true },
      { key: "riskScore", label: "Risk score", type: "number", surface: true, store: false, sourceSystem: system, sourceField: "customfield_10201", precision: 0 },
      { key: "contactEmail", label: "Contact email", type: "string", surface: true, store: false, sourceSystem: system, sourceField: "customfield_10202", maxLength: 254, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
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

  // ── Native handoff (companion-app bridge). The demo fronts an illustrative "demoboard" vendor so the
  //    reference-level flow is exercisable end to end; a real connector advertises the vendors it actually
  //    fronts. Handoff URLs are minted against the vendor's allowlisted host — never from user input.
  async nativeSurfaces(_ctx: ActorContext): Promise<NativeSurface[]> {
    return [
      { kind: "whiteboard", vendor: "demoboard", label: "Open in DemoBoard", actions: ["open", "create", "embed"], importMode: "reference" },
      { kind: "dashboard", vendor: "demoboard", label: "Open in DemoBoard", actions: ["open", "create"], importMode: "reference" },
    ];
  }

  async nativeHandoff(_ctx: ActorContext, req: NativeHandoffRequest): Promise<NativeHandoff> {
    const url = buildVendorUrl(req.vendor, req.kind, req.action, req.externalRef);
    // Tier-2 embed: also mint the vendor's sandboxed Live-Embed URL (host-allowlisted) for an inline preview.
    const embedUrl = req.action === "embed" ? buildEmbedUrl(req.vendor, req.kind, req.externalRef) : undefined;
    return { url, ...(embedUrl ? { embedUrl } : {}), handoffId: `ho-${++taskAttachmentCounter}` };
  }

  async nativeImport(ctx: ActorContext, req: NativeImportRequest): Promise<TaskAttachment> {
    // Reference mode: reconstruct the canonical (host-allowlisted) URL and attach it to the target — a link,
    // nothing copied. A real connector with importMode "content" would additionally pull data via safeFetch.
    const url = buildVendorUrl(req.vendor, req.kind, "open", req.externalRef);
    return {
      id: `ta-${++taskAttachmentCounter}`,
      taskId: req.target.issueId ?? req.target.projectId,
      filename: `${req.vendor}:${req.kind}`,
      url,
      contentType: "text/uri-list",
      size: null,
      addedBy: ctx.email ?? ctx.name ?? "demo@local",
      addedAt: new Date().toISOString(),
    };
  }

  async verify(): Promise<VerifyReport> {
    return { ok: true, actions: [] };
  }
}
