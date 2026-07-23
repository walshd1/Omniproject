/**
 * Task routes — GTD actionable next-actions (distinct from issues): list/create/update, comments,
 * attachments, plus recurring-task expansion on completion and the in-app reminder sweep.
 */
import { Router, type Request, type Response } from "express";
import { withBrokerErrors } from "../broker";
import { getTasks, getTask, createTask, updateTask, brokerHasTasks, getTaskComments, addTaskComment, getTaskAttachments, addTaskAttachment, brokerHasTaskAttachments } from "../lib/data";
import { requireRole, roleForReq } from "../lib/rbac";
import { assertTaskScope, filterTasksInScope } from "../lib/project-scope";
import { auditScopeDenied, recordAudit } from "../lib/audit";
import { evaluateRuleset } from "../lib/ruleset";
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

/**
 * Enforce the business ruleset on a task write — the SAME engine that guards issue writes
 * (routes/projects.passesBusinessRules), so a rule like "require-priority" applies consistently to the
 * GTD task surface too. Restrict-only, and runs AFTER the RBAC/shape gates. A hard block is 422
 * `{ error, rule }`; warnings ride back on the X-OmniProject-Rule-Warnings header. GTD tasks may have no
 * project, so projectId is nullable (a null scope resolves to the org-level ruleset).
 */
function passesTaskRules(req: Request, res: Response, action: "create_task" | "update_task", body: Record<string, unknown>): boolean {
  const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null;
  const verdict = evaluateRuleset({ action, write: true, role: roleForReq(req), projectId, payload: body });
  if (!verdict.allow) {
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `rule_block:${verdict.blocked!.id}`, projectId, result: "error", status: 422 });
    res.status(422).json({ error: verdict.blocked!.message, rule: verdict.blocked!.id });
    return false;
  }
  if (verdict.warnings.length) res.setHeader("X-OmniProject-Rule-Warnings", verdict.warnings.map((w) => w.id).join(","));
  return true;
}

// POST /api/tasks — create a next-action (manager+). 501 when the backend has no task model.
router.post("/tasks", requireRole("manager"), (req, res) => {
  if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return; }
  const body = parseOr400(req, res, TaskBody);
  if (!body) return;
  if (!body.title) { res.status(400).json({ error: "title is required" }); return; }
  if (!checkTaskStatus(req, res, body)) return;
  if (!checkTaskEnergy(req, res, body)) return;
  if (!passesTaskRules(req, res, "create_task", body as Record<string, unknown>)) return;
  return withBrokerErrors(req, res, "create_task failed", async () => {
    res.status(201).json(await createTask(req, body));
  });
});

// PATCH /api/tasks/:taskId — update a task (manager+).
router.patch("/tasks/:taskId", requireRole("manager"), (req, res) => {
  if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return; }
  const body = parseOr400(req, res, TaskBody);
  if (!body) return;
  if (!checkTaskStatus(req, res, body)) return;
  if (!checkTaskEnergy(req, res, body)) return;
  if (!passesTaskRules(req, res, "update_task", body as Record<string, unknown>)) return;
  return withBrokerErrors(req, res, "update_task failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    const updated = await updateTask(req, String(req.params["taskId"]), body);
    // Completing a recurring task spawns its next occurrence (Todoist-style), surfaced on the response.
    const next = await maybeSpawnRecurrence(req, updated, body as Record<string, unknown>);
    res.json(next ? { ...updated, nextOccurrence: { id: next.id, dueDate: next.dueDate } } : updated);
  });
});

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

router.get("/tasks/:taskId/comments", (req, res) =>
  withBrokerErrors(req, res, "list_task_comments failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    res.json(await getTaskComments(req, String(req.params["taskId"])));
  }),
);

router.post("/tasks/:taskId/comments", requireRole("contributor"), (req, res) => {
  const body = parseOr400(req, res, CommentBody);
  if (!body) return;
  return withBrokerErrors(req, res, "add_task_comment failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    res.status(201).json(await addTaskComment(req, String(req.params["taskId"]), body));
  });
});

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

router.post("/tasks/:taskId/attachments", requireRole("contributor"), (req, res) => {
  // "If supported by the backend" — 501 when the active broker can't store attachments.
  if (!brokerHasTaskAttachments()) { res.status(501).json({ error: "this backend does not support task attachments" }); return; }
  const body = parseOr400(req, res, AttachmentBody);
  if (!body) return;
  return withBrokerErrors(req, res, "add_task_attachment failed", async () => {
    if (!(await guardTaskAccess(req, res, String(req.params["taskId"])))) return;
    res.status(201).json(await addTaskAttachment(req, String(req.params["taskId"]), body));
  });
});

export default router;
