import { Router } from "express";
import { withBrokerErrors } from "../broker";
import { getTasks, getTask, createTask, updateTask, brokerHasTasks, getTaskComments, addTaskComment, getTaskAttachments, addTaskAttachment, brokerHasTaskAttachments } from "../lib/data";
import { requireRole } from "../lib/rbac";
import { parseOr400, v } from "../lib/validate";
import { CANONICAL_TASK_STATUS, CANONICAL_PRIORITY, CANONICAL_ENERGY } from "../broker/vocabulary";
import { summariseTasks } from "../lib/task-summary";

/**
 * Task endpoints — GTD actionable next-actions, DISTINCT from issues (problems/blockers). Reads degrade
 * to an empty list when the active backend doesn't model tasks; writes 501 in that case (nothing to
 * write to). Status is a GTD state; the create/update bodies are validated at the boundary.
 */
const router = Router();

const TaskBody = v.object({
  title: v.optional(v.string({ min: 1, max: 500, trim: true })),
  status: v.optional(v.enum(CANONICAL_TASK_STATUS)),
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
  energy: v.optional(v.nullable(v.enum(CANONICAL_ENERGY))),
  section: v.optional(v.nullable(v.string({ max: 200 }))),
  sortOrder: v.optional(v.nullable(v.number())),
  collaborators: v.optional(v.array(v.string({ min: 1, max: 200, trim: true }), { max: 100 })),
});

// GET /api/tasks?projectId= — actionable tasks, optionally scoped to a project.
router.get("/tasks", (req, res) =>
  withBrokerErrors(req, res, "list_tasks failed", async () => {
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    res.json(await getTasks(req, projectId ? { projectId } : {}));
  }),
);

// GET /api/tasks/summary(?projectId=) — the task roll-up for reports (GTD breakdown, overdue, by
// assignee/tag/context). Declared before /tasks/:taskId so "summary" isn't read as a task id.
router.get("/tasks/summary", (req, res) =>
  withBrokerErrors(req, res, "task_summary failed", async () => {
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    res.json(summariseTasks(await getTasks(req, projectId ? { projectId } : {})));
  }),
);

// GET /api/tasks/:taskId — one task, 404 if unknown.
router.get("/tasks/:taskId", (req, res) =>
  withBrokerErrors(req, res, "get_task failed", async () => {
    const task = await getTask(req, String(req.params["taskId"]));
    if (!task) { res.status(404).json({ error: "No such task" }); return; }
    res.json(task);
  }),
);

// POST /api/tasks — create a next-action (manager+). 501 when the backend has no task model.
router.post("/tasks", requireRole("manager"), (req, res) => {
  if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return; }
  const body = parseOr400(req, res, TaskBody);
  if (!body) return;
  if (!body.title) { res.status(400).json({ error: "title is required" }); return; }
  return withBrokerErrors(req, res, "create_task failed", async () => {
    res.status(201).json(await createTask(req, body));
  });
});

// PATCH /api/tasks/:taskId — update a task (manager+).
router.patch("/tasks/:taskId", requireRole("manager"), (req, res) => {
  if (!brokerHasTasks()) { res.status(501).json({ error: "this backend does not support tasks" }); return; }
  const body = parseOr400(req, res, TaskBody);
  if (!body) return;
  return withBrokerErrors(req, res, "update_task failed", async () => {
    res.json(await updateTask(req, String(req.params["taskId"]), body));
  });
});

// ── Comments ─────────────────────────────────────────────────────────────────
const CommentBody = v.object({ body: v.string({ min: 1, max: 10_000, trim: true }) });

router.get("/tasks/:taskId/comments", (req, res) =>
  withBrokerErrors(req, res, "list_task_comments failed", async () => {
    res.json(await getTaskComments(req, String(req.params["taskId"])));
  }),
);

router.post("/tasks/:taskId/comments", requireRole("contributor"), (req, res) => {
  const body = parseOr400(req, res, CommentBody);
  if (!body) return;
  return withBrokerErrors(req, res, "add_task_comment failed", async () => {
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
    res.json(await getTaskAttachments(req, String(req.params["taskId"])));
  }),
);

router.post("/tasks/:taskId/attachments", requireRole("contributor"), (req, res) => {
  // "If supported by the backend" — 501 when the active broker can't store attachments.
  if (!brokerHasTaskAttachments()) { res.status(501).json({ error: "this backend does not support task attachments" }); return; }
  const body = parseOr400(req, res, AttachmentBody);
  if (!body) return;
  return withBrokerErrors(req, res, "add_task_attachment failed", async () => {
    res.status(201).json(await addTaskAttachment(req, String(req.params["taskId"]), body));
  });
});

export default router;
