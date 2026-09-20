/**
 * Task routes — GTD actionable next-actions (distinct from issues): list/create/update, comments,
 * attachments, plus recurring-task expansion on completion and the in-app reminder sweep.
 */
import { Router, type Request, type Response } from "express";
import { withBrokerErrors } from "../broker";
import { getTasks, getTask, createTask, updateTask, brokerHasTasks, getTaskComments, addTaskComment, getTaskAttachments, addTaskAttachment, brokerHasTaskAttachments } from "../lib/data";
import { requireRole, roleForReq } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { runTaskBulk, taskBulkFingerprint, MAX_TASK_BULK_ITEMS } from "../lib/task-bulk-actions";
import { planTaskBulk } from "@workspace/backend-catalogue";
import { mountEntity, type EntityDescriptor } from "../lib/entity-pipeline";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { assertTaskScope, filterTasksInScope, guardProjectScope } from "../lib/project-scope";
import { auditScopeDenied, recordRequestAudit } from "../lib/audit";
import { getSession } from "./auth";
import { parseOr400, v } from "../lib/validate";
import { CANONICAL_PRIORITY, isTaskDone } from "../broker/vocabulary";
import { resolveTaskVocabulary } from "../lib/task-vocabulary-config";
import { resolveEnergyVocabulary } from "../lib/energy-vocabulary-config";
import type { ConfigScopes } from "../lib/scoped-config";
import { summariseTasks } from "../lib/task-summary";
import { nextOccurrence } from "../lib/recurrence";
import { runReminderSweep } from "../lib/reminder-sweep";
import { getNotifyBus } from "../lib/notify-bus";
import { sharedKv } from "../lib/shared-state";
import crypto from "node:crypto";
import type { Task } from "../broker/types";

const REMINDER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a fired reminder is remembered for 30d (dedupe window)

/**
 * Recurring-task expansion (Todoist-style): when a PATCH COMPLETES a task that carries a `recurrence` rule,
 * spawn the following occurrence — a fresh actionable task with the next due/start dates — so a recurring
 * task actually recurs instead of just being marked done. The reference date is the task's due date (else
 * its start date, else its completion time). Returns the new task, or null when it doesn't recur.
 */
async function maybeSpawnRecurrence(req: Request, completed: Task, patch: Record<string, unknown>): Promise<Task | null> {
  if (!isTaskDone(patch["status"] as string | undefined)) return null; // only on completion (not on drop)
  const rule = completed.recurrence;
  const ref = completed.dueDate ?? completed.startDate ?? completed.completedAt ?? new Date().toISOString();
  const nextDue = nextOccurrence(rule, ref);
  if (!nextDue) return null; // one-off / unparseable rule → nothing to spawn
  // Idempotent spawn: a double-clicked "complete", a client retry, or two concurrent PATCH-to-done must not
  // each create the next occurrence. Only the sweep that wins this atomic claim (keyed by the completed task
  // + its next due date) spawns; the rest are no-ops.
  if (!(await sharedKv.cas(`recur:spawned:${completed.id}:${nextDue}`, null, "1", { ttlMs: REMINDER_TTL_MS }))) return null;
  // Carry the defining fields forward; the next instance starts fresh (actionable, not done).
  const nextStart = completed.startDate && completed.dueDate
    ? nextOccurrence(rule, completed.startDate) // keep the same lead time when both dates were set
    : null;
  return createTask(req, {
    title: completed.title,
    ...(completed.projectId ? { projectId: completed.projectId } : {}),
    status: "next",
    recurrence: rule,
    dueDate: nextDue,
    ...(nextStart ? { startDate: nextStart } : {}),
    ...(completed.priority ? { priority: completed.priority } : {}),
    ...(completed.context ? { context: completed.context } : {}),
    ...(completed.assignee ? { assignee: completed.assignee } : {}),
    ...(completed.description ? { description: completed.description } : {}),
    ...(completed.tags && completed.tags.length ? { tags: completed.tags } : {}),
    ...(completed.reminderAt ? { reminderAt: shiftReminder(completed.reminderAt, ref, nextDue) } : {}),
  });
}

/** Shift a reminder by the same offset the due date moved, so a "remind me the morning of" stays relative. */
function shiftReminder(reminderAt: string, oldRef: string, newDue: string): string {
  const delta = Date.parse(newDue) - Date.parse(oldRef.slice(0, 10));
  const shifted = Date.parse(reminderAt) + delta;
  return Number.isNaN(shifted) ? reminderAt : new Date(shifted).toISOString();
}

/** The caller's identity tokens, for the personal-task owner check. */
function whoami(req: Request): string[] {
  const s = getSession(req);
  return [s?.sub, s?.email, s?.name].filter((x): x is string => typeof x === "string" && !!x);
}

/** The scopes for resolving the task vocabulary on a write: programme from the query, project from the write
 *  body (falling back to the query), user from the auth session — so a scope-added task status is honoured. */
function taskScopesFromReq(req: Request, body?: { projectId?: string | null | undefined }): ConfigScopes {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  const projectId = body && typeof body.projectId === "string" && body.projectId
    ? body.projectId
    : (typeof q["projectId"] === "string" && q["projectId"] ? q["projectId"] : undefined);
  if (projectId) scopes.projectId = projectId;
  const s = getSession(req);
  if (s?.sub) scopes.sub = s.sub;
  return scopes;
}

/**
 * Membership-check a write's `status` against the RESOLVED task vocabulary for the request scope (the relaxed
 * gate that replaces the frozen `v.enum`). An absent status passes (it's optional); a status present in the
 * scoped set passes; a truly-unknown id is rejected with 400. Returns false (having sent the 400) on a miss.
 */
function checkTaskStatus(req: Request, res: Response, body: { status?: string | undefined; projectId?: string | null | undefined }): boolean {
  if (body.status === undefined) return true;
  const { statuses } = resolveTaskVocabulary(taskScopesFromReq(req, body));
  if (statuses.some((s) => s.id === body.status)) return true;
  res.status(400).json({ error: "invalid request", issues: [`status "${body.status}" is not a task status in this scope`] });
  return false;
}

/**
 * Membership-check a write's `energy` against the RESOLVED energy vocabulary for the request scope (the relaxed
 * gate that replaces the frozen `v.enum(CANONICAL_ENERGY)`). An absent or null energy passes (it's optional /
 * clearable); an energy present in the scoped set passes; a truly-unknown id is rejected with 400. Returns
 * false (having sent the 400) on a miss.
 */
function checkTaskEnergy(req: Request, res: Response, body: { energy?: string | null | undefined; projectId?: string | null | undefined }): boolean {
  if (body.energy === undefined || body.energy === null) return true;
  const { levels } = resolveEnergyVocabulary(taskScopesFromReq(req, body));
  if (levels.some((l) => l.id === body.energy)) return true;
  res.status(400).json({ error: "invalid request", issues: [`energy "${body.energy}" is not an energy level in this scope`] });
  return false;
}

/**
 * Fetch a task by id and enforce the caller's scope on it (IDOR guard — getTask is scope-blind at the
 * broker). Sends 404 if unknown, 403 if out of scope, and returns null in both cases; otherwise the task.
 * Usage: `const task = await guardTaskAccess(req, res, id); if (!task) return;`
 */
async function guardTaskAccess(req: Request, res: Response, taskId: string): Promise<Task | null> {
  const task = await getTask(req, taskId);
  if (!task) { res.status(404).json({ error: "No such task" }); return null; }
  if (!(await assertTaskScope(req, task, whoami(req)))) {
    auditScopeDenied(req, "task", taskId, "task not in your scope"); // lateral-movement attempt — audited
    res.status(403).json({ error: "task not in your scope" });
    return null;
  }
  return task;
}

/**
 * Task endpoints — GTD actionable next-actions, DISTINCT from issues (problems/blockers). Reads degrade
 * to an empty list when the active backend doesn't model tasks; writes 501 in that case (nothing to
 * write to). Status is a GTD state; the create/update bodies are validated at the boundary.
 */
const router = Router();

const TaskBody = v.object({
  title: v.optional(v.string({ min: 1, max: 500, trim: true })),
  // Status is a GTD state, but the task status axis is now SCOPE-OVERRIDABLE (an org/methodology can add,
  // relabel or remove statuses — see task-vocabulary-config). The frozen `v.enum(CANONICAL_TASK_STATUS)` gate
  // is relaxed to a bounded string here; the handler membership-checks it against the RESOLVED task vocabulary
  // for the request scope (`checkTaskStatus`), so any scope-added status is accepted while garbage is 400.
  status: v.optional(v.string({ min: 1, max: 100, trim: true })),
  projectId: v.optional(v.nullable(v.string({ max: 200 }))),
  context: v.optional(v.nullable(v.string({ max: 200 }))),
  waitingOn: v.optional(v.nullable(v.string({ max: 500 }))),
  assignee: v.optional(v.nullable(v.string({ max: 200 }))),
  description: v.optional(v.nullable(v.string({ max: 10_000 }))),
  priority: v.optional(v.nullable(v.enum(CANONICAL_PRIORITY))),
  tags: v.optional(v.array(v.string({ min: 1, max: 100, trim: true }), { max: 50 })),
  startDate: v.optional(v.nullable(v.string({ max: 40 }))),
  dueDate: v.optional(v.nullable(v.string({ max: 40 }))),
  recurrence: v.optional(v.nullable(v.string({ max: 200 }))),
  estimateHours: v.optional(v.nullable(v.number({ min: 0 }))),
  parentTaskId: v.optional(v.nullable(v.string({ max: 200 }))),
  url: v.optional(v.nullable(v.string({ max: 2000 }))),
  completedAt: v.optional(v.nullable(v.string({ max: 40 }))),
  reminderAt: v.optional(v.nullable(v.string({ max: 40 }))),
  // Energy is a GTD "in the tank" level, now SCOPE-OVERRIDABLE (an org/methodology can add, relabel or remove
  // levels — see energy-vocabulary-config). The frozen `v.enum(CANONICAL_ENERGY)` gate is relaxed to a bounded
  // string here; the handler membership-checks it against the RESOLVED energy vocabulary for the request scope
  // (`checkTaskEnergy`), so any scope-added level is accepted while garbage is 400.
  energy: v.optional(v.nullable(v.string({ min: 1, max: 100, trim: true }))),
  section: v.optional(v.nullable(v.string({ max: 200 }))),
  sortOrder: v.optional(v.nullable(v.number())),
  collaborators: v.optional(v.array(v.string({ min: 1, max: 200, trim: true }), { max: 100 })),
});

// GET /api/tasks?projectId= — actionable tasks, optionally scoped to a project.
router.get("/tasks", (req, res) =>
  withBrokerErrors(req, res, "list_tasks failed", async () => {
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    // IDOR guard: broker listTasks is scope-blind (it just filters by projectId), so a scoped caller
    // could otherwise read out-of-scope project tasks — or, with no projectId, the whole task list plus
    // other users' personal tasks. Re-derive scope at the gateway and drop anything the caller can't see.
    const tasks = await filterTasksInScope(req, await getTasks(req, projectId ? { projectId } : {}), whoami(req));
    res.json(tasks);
  }),
);

// GET /api/tasks/summary(?projectId=) — the task roll-up for reports (GTD breakdown, overdue, by
// assignee/tag/context). Declared before /tasks/:taskId so "summary" isn't read as a task id.
router.get("/tasks/summary", (req, res) =>
  withBrokerErrors(req, res, "task_summary failed", async () => {
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    // Same IDOR guard as GET /tasks: summarise only the tasks in the caller's scope, never the raw list.
    const tasks = await filterTasksInScope(req, await getTasks(req, projectId ? { projectId } : {}), whoami(req));
    res.json(summariseTasks(tasks));
  }),
);

// GET /api/tasks/:taskId — one task, 404 if unknown, 403 if out of the caller's scope.
router.get("/tasks/:taskId", (req, res) =>
  withBrokerErrors(req, res, "get_task failed", async () => {
    const task = await guardTaskAccess(req, res, String(req.params["taskId"]));
    if (!task) return;
    res.json(task);
  }),
);

// Tasks (manager+). LANE 1 (entity pipeline): create + update run the fixed RBAC → validate → ruleset → scope →
// write sequence via mountEntity. The descriptor SCOPE is the task-access guard (not a project IDOR), through
// the pipeline's custom-scope variant — but CREATE overrides it to `none` (a new task has no task to guard
// yet, exactly as the hand-written POST did). Migrating onto the spine also brings the business ruleset to task
// writes (create_task / update_task) for the first time — a deliberate GAP-CLOSURE so a portfolio read-only
// freeze / an any-write field rule now covers tasks like every other governed write (previously they bypassed
// the ruleset). 501 when the backend has no task model.
export const taskEntity: EntityDescriptor = {
  entity: "task",
  basePath: "/tasks",
  idParam: "taskId",
  scope: { kind: "custom", guard: async (req, res) => !!(await guardTaskAccess(req, res, String(req.params["taskId"]))) },
  create: {
    role: "manager",
    ruleAction: "create_task",
    scope: { kind: "none" }, // no EXISTING task to guard on create; the DESTINATION project is guarded in validate
    validate: async (req, res) => {
      if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return null; }
      const body = parseOr400(req, res, TaskBody);
      if (!body) return null;
      if (!body.title) { res.status(400).json({ error: "title is required" }); return null; }
      // Bind the task to a project the caller is scoped to: create used scope:none, so without this a
      // programme-scoped manager could plant a task into any project by naming a foreign projectId (IDOR).
      if (body.projectId && !(await guardProjectScope(req, res, body.projectId))) return null;
      if (!checkTaskStatus(req, res, body)) return null;
      if (!checkTaskEnergy(req, res, body)) return null;
      return body;
    },
    run: async (req, _res, body) => createTask(req, body as Parameters<typeof createTask>[1]),
  },
  update: {
    role: "manager",
    ruleAction: "update_task",
    validate: async (req, res) => {
      if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return null; }
      const body = parseOr400(req, res, TaskBody);
      if (!body) return null;
      // The custom scope guard covers the SOURCE task; a relocation into a new project must also clear the
      // DESTINATION project's scope, or an update could move a task into a project the caller can't reach.
      if (body.projectId && !(await guardProjectScope(req, res, body.projectId))) return null;
      if (!checkTaskStatus(req, res, body)) return null;
      if (!checkTaskEnergy(req, res, body)) return null;
      return body;
    },
    run: async (req, _res, body) => {
      const updated = await updateTask(req, String(req.params["taskId"]), body as Parameters<typeof updateTask>[2]);
      // Completing a recurring task spawns its next occurrence (Todoist-style), surfaced on the response.
      const next = await maybeSpawnRecurrence(req, updated, body as Record<string, unknown>);
      return next ? { ...updated, nextOccurrence: { id: next.id, dueDate: next.dueDate } } : updated;
    },
  },
};
mountEntity(router, taskEntity);

// POST /api/tasks/reminders/sweep — deliver any DUE task reminders in-app (pmo+, cron/routine-driven). Fires
// each task whose `reminderAt` has passed once (deduped via shared-state), notifying the assignee. Runs in
// the caller's scope, so a portfolio-wide sweep needs a portfolio (pmo/admin) caller.
router.post("/tasks/reminders/sweep", requireRole("pmo"), (req, res) =>
  withBrokerErrors(req, res, "reminder sweep failed", async () => {
    if (!brokerHasTasks()) { res.json({ fired: 0, taskIds: [] }); return; }
    const tasks = await getTasks(req);
    const bus = getNotifyBus();
    const result = await runReminderSweep({
      tasks,
      nowMs: Date.now(),
      isFired: async (key) => !!(await sharedKv.get(key)),
      // Atomic claim (set-if-absent) — only the sweep that wins delivers, so overlapping or multi-replica
      // sweeps can't double-fire the same reminder.
      claim: async (key) => sharedKv.cas(key, null, "1", { ttlMs: REMINDER_TTL_MS }),
      notify: (n, target) => void bus.publish({
        notification: { id: `rem-${crypto.randomUUID()}`, kind: n.kind, title: n.title, body: n.body, read: false, timestamp: Date.now() },
        ...(target.sub || target.email ? { target } : {}),
      }),
    });
    res.json(result);
  }),
);

// ── Comments ─────────────────────────────────────────────────────────────────
const CommentBody = v.object({ body: v.string({ min: 1, max: 10_000, trim: true }) });
/** The validated bodies the sub-resource writers accept — taken from the writers themselves so the command
 *  args can't drift from what `addTaskComment` / `addTaskAttachment` expect. */
type TaskCommentInput = Parameters<typeof addTaskComment>[2];
type TaskAttachmentInput = Parameters<typeof addTaskAttachment>[2];

router.get("/tasks/:taskId/comments", (req, res) =>
  withBrokerErrors(req, res, "list_task_comments failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    res.json(await getTaskComments(req, String(req.params["taskId"])));
  }),
);

// Add a comment to a task (contributor+). On the Lane 2 spine: the task load + scope guard is the async
// `prepare` (a task's projectId — needed for the ruleset scope — isn't known until the task is fetched), so
// the write runs RBAC → parse → guard/scope → ruleset → run → audit by construction (it recorded no audit
// as a hand-written route). Broker-aware: a broker error loading or writing maps to its status, no audit.
export const addTaskCommentCommand: CommandDescriptor<{ body: TaskCommentInput; task: Task }, { body: TaskCommentInput }> = {
  name: "add_task_comment",
  method: "post",
  path: "/tasks/:taskId/comments",
  role: "contributor",
  parse: (req, res) => {
    const body = parseOr400(req, res, CommentBody);
    return body ? { body } : null;
  },
  prepare: async (req, res, { body }) => {
    const task = await guardTaskAccess(req, res, String(req.params["taskId"]));
    return task ? { body, task } : null;
  },
  ruleScope: (_req, { body, task }) => ({ projectId: task.projectId ?? null, payload: body as unknown as Record<string, unknown> }),
  broker: { message: "add_task_comment failed" },
  run: (req, _res, { body }) => addTaskComment(req, String(req.params["taskId"]), body),
  audit: "add_task_comment",
  status: 201,
};
mountCommand(router, addTaskCommentCommand);

// ── Attachments (file REFERENCES; only when the backend supports them) ────────
const AttachmentBody = v.object({
  filename: v.string({ min: 1, max: 500, trim: true }),
  url: v.optional(v.nullable(v.string({ max: 2000 }))),
  contentType: v.optional(v.nullable(v.string({ max: 200 }))),
  size: v.optional(v.nullable(v.number({ min: 0, int: true }))),
});

router.get("/tasks/:taskId/attachments", (req, res) =>
  withBrokerErrors(req, res, "list_task_attachments failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    res.json(await getTaskAttachments(req, String(req.params["taskId"])));
  }),
);

// Add a file-reference attachment to a task (contributor+), when the backend supports them. Same Lane 2
// shape as comments: a capability gate (501) precedes parse, then the async `prepare` loads + scope-guards
// the task for the ruleset. Broker-aware; audits on success (the hand-written route recorded none).
export const addTaskAttachmentCommand: CommandDescriptor<{ body: TaskAttachmentInput; task: Task }, { body: TaskAttachmentInput }> = {
  name: "add_task_attachment",
  method: "post",
  path: "/tasks/:taskId/attachments",
  role: "contributor",
  // "If supported by the backend" — 501 when the active broker can't store attachments.
  gates: [(_req, res, next) => { if (!brokerHasTaskAttachments()) { res.status(501).json({ error: "this backend does not support task attachments" }); return; } next(); }],
  parse: (req, res) => {
    const body = parseOr400(req, res, AttachmentBody);
    return body ? { body } : null;
  },
  prepare: async (req, res, { body }) => {
    const task = await guardTaskAccess(req, res, String(req.params["taskId"]));
    return task ? { body, task } : null;
  },
  ruleScope: (_req, { body, task }) => ({ projectId: task.projectId ?? null, payload: body as unknown as Record<string, unknown> }),
  broker: { message: "add_task_attachment failed" },
  run: (req, _res, { body }) => addTaskAttachment(req, String(req.params["taskId"]), body),
  audit: "add_task_attachment",
  status: 201,
};
mountCommand(router, addTaskAttachmentCommand);

/**
 * POST /api/tasks/bulk — apply ONE canonical change to many GTD tasks at once (task-management gap T5).
 * Mirrors the project bulk runner (/admin/bulk): manager+ RBAC, a fresh step-up re-auth (a batch is
 * high-blast-radius), a dry-run preview + a secondary confirmation token, and per-item partial success.
 * The pure `planTaskBulk` validates + resolves each change and skips no-ops; each planned item then runs
 * through the same gated write path a single PATCH does (task scope → ruleset("update_task") → broker
 * updateTask). Only tasks the caller can already see (scope-filtered) are eligible; requested ids that
 * aren't found/in-scope are reported as `missing`, never leaked.
 */
const TASK_BULK_BODY = v.object({
  op: v.enum(["complete", "reopen", "reassign", "set_priority", "set_context", "move_section"] as const),
  ids: v.array(v.string({ trim: true, min: 1, max: 200 })),
  assignee: v.optional(v.string({ trim: true, max: 200 })),
  priority: v.optional(v.string({ trim: true, max: 40 })),
  context: v.optional(v.string({ trim: true, max: 100 })),
  section: v.optional(v.string({ trim: true, max: 200 })),
  dryRun: v.optional(v.boolean()),
  confirm: v.optional(v.string({ max: 128 })),
});

router.post("/tasks/bulk", requireRole("manager"), requireStepUp, async (req, res) => {
  const body = parseOr400(req, res, TASK_BULK_BODY);
  if (!body) return;
  const ids = body.ids ?? [];
  if (ids.length === 0) { res.status(400).json({ error: "tasks/bulk requires a non-empty ids[]" }); return; }
  if (ids.length > MAX_TASK_BULK_ITEMS) { res.status(413).json({ error: `Too many items: ${ids.length} exceeds the ${MAX_TASK_BULK_ITEMS}-task bulk cap. Split the batch.` }); return; }

  const dryRun = body.dryRun === true;
  // Resolve only the requested tasks the caller may actually see (scope-filtered), keyed by id.
  const visible = await filterTasksInScope(req, await getTasks(req, {}), whoami(req));
  const wanted = new Set(ids.map(String));
  const selected = visible.filter((t) => wanted.has(String(t.id)));
  const projectById = new Map(selected.map((t) => [String(t.id), t.projectId ?? null]));
  const tasksForPlan = selected.map((t) => ({ id: String(t.id), status: t.status ?? null, assignee: t.assignee ?? null, priority: t.priority ?? null, context: t.context ?? null, section: t.section ?? null }));

  const spec = {
    op: body.op,
    ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.context !== undefined ? { context: body.context } : {}),
    ...(body.section !== undefined ? { section: body.section } : {}),
  };
  const options = { validPriorities: [...CANONICAL_PRIORITY] };

  // Secondary confirmation: a real (non-dry-run) execute must echo the fingerprint of THIS exact plan.
  const confirmToken = taskBulkFingerprint(planTaskBulk(tasksForPlan, spec, options).fingerprintInput);
  if (!dryRun && body.confirm !== confirmToken) {
    res.status(428).json({ error: "This bulk action needs a secondary confirmation. Preview it, then resend with the confirm token.", code: "confirmation_required", confirmToken });
    return;
  }

  const outcome = await runTaskBulk({
    tasks: tasksForPlan,
    spec,
    options,
    role: roleForReq(req),
    dryRun,
    apply: async (id, changes) => updateTask(req, id, changes as Parameters<typeof updateTask>[2]),
    projectIdOf: (id) => projectById.get(id) ?? null,
    onItemError: (id, err) => req.log.error({ err, id }, "task bulk item failed"),
  });

  const missing = ids.length - tasksForPlan.length; // requested but not found / out of scope
  recordRequestAudit(req, {
    category: "admin",
    action: dryRun ? "task_bulk_preview" : "task_bulk_execute",
    write: !dryRun,
    result: dryRun || outcome.applied > 0 ? "success" : "error",
    status: 200,
    meta: { op: body.op, dryRun, requested: ids.length, resolved: tasksForPlan.length, missing, applied: outcome.applied, skipped: outcome.skipped, errored: outcome.errored },
  });

  const status = dryRun || outcome.applied === outcome.total ? 200 : outcome.applied === 0 ? 422 : 207;
  res.status(status).json({ ...outcome, missing, ...(dryRun ? { confirmToken } : {}) });
});

export default router;
