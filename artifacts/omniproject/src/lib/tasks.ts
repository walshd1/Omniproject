import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client access to the GTD TASK entity (`/api/tasks`) — actionable next-actions, DISTINCT from issues
 * (which this app's nomenclature already labels "Tasks"). To avoid that collision the UI calls these
 * "Next actions". Tasks aren't in the OpenAPI contract yet, so these are thin fetch hooks rather than
 * generated ones.
 */

export interface Task {
  id: string;
  title: string;
  status: string;
  projectId?: string | null;
  /** Parent task id (its subtask link), or null/absent for a top-level task. */
  parentTaskId?: string | null;
  context?: string | null;
  waitingOn?: string | null;
  assignee?: string | null;
  description?: string | null;
  priority?: string | null;
  tags?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  /** Recurrence rule (free text, e.g. "every 2 weeks", "every weekday", "FREQ=MONTHLY"). The server spawns
   *  the next occurrence when a recurring task is completed. Empty/one-off ⇒ no repeat. */
  recurrence?: string | null;
  reminderAt?: string | null;
  energy?: string | null;
  section?: string | null;
  completedAt?: string | null;
  url?: string | null;
}

export interface TaskSummary {
  total: number;
  byClass: Record<"actionable" | "waiting" | "deferred" | "done" | "dropped", number>;
  open: number;
  actionable: number;
  overdue: number;
  dueSoon: number;
  unassigned: number;
  byAssignee: Record<string, number>;
  byTag: Record<string, number>;
  byContext: Record<string, number>;
}

/** GTD priority, optional — "none" is the unset default (mirrors the server's CANONICAL_PRIORITY). */
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASKS_KEY = ["tasks"] as const;

export function useTasks(projectId?: string) {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return useQuery({ queryKey: [...TASKS_KEY, projectId ?? "all"], queryFn: () => getJson<Task[]>(`/api/tasks${q}`) });
}

export function useTaskSummary() {
  return useQuery({ queryKey: [...TASKS_KEY, "summary"], queryFn: () => getJson<TaskSummary>("/api/tasks/summary") });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Task>) => sendJson<Task>("/api/tasks", body, "POST", "Could not create the next action"),
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

/** Result of a bulk create: how many of the N attempts landed, and how many failed. */
export interface BulkCreateResult { created: Task[]; failed: number; total: number }

/**
 * Create MANY tasks in one go (the multi-entry / auto-split path). Fires the N `POST /api/tasks` calls
 * concurrently and settles ALL of them — a single bad line never aborts the rest — then invalidates the
 * task queries ONCE. Returns the created tasks plus a failure count so the caller can report partial
 * success. Tasks aren't in the OpenAPI contract, so this stays a thin fetch hook like {@link useCreateTask}.
 */
export function useCreateTasksBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bodies: Partial<Task>[]): Promise<BulkCreateResult> => {
      const settled = await Promise.allSettled(
        bodies.map((body) => sendJson<Task>("/api/tasks", body, "POST", "Could not create the next action")),
      );
      const created = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      return { created, failed: settled.length - created.length, total: settled.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => sendJson<Task>(`/api/tasks/${encodeURIComponent(id)}`, patch, "PATCH", "Could not update the next action"),
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

// ── Comments + attachments ────────────────────────────────────────────────────

export interface TaskComment { id: string; taskId: string; body: string; author?: string | null; createdAt: string }
export interface TaskAttachment { id: string; taskId: string; filename: string; url?: string | null; contentType?: string | null; size?: number | null; addedBy?: string | null; addedAt: string }

const enc = encodeURIComponent;

export function useTaskComments(id: string, enabled = true) {
  return useQuery({ queryKey: [...TASKS_KEY, id, "comments"], enabled, queryFn: () => getJson<TaskComment[]>(`/api/tasks/${enc(id)}/comments`) });
}
export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendJson<TaskComment>(`/api/tasks/${enc(id)}/comments`, { body }, "POST", "Could not add the comment"),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TASKS_KEY, id, "comments"] }),
  });
}

export function useTaskAttachments(id: string, enabled = true) {
  return useQuery({ queryKey: [...TASKS_KEY, id, "attachments"], enabled, queryFn: () => getJson<TaskAttachment[]>(`/api/tasks/${enc(id)}/attachments`) });
}
export function useAddAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (att: { filename: string; url?: string; contentType?: string; size?: number }) => sendJson<TaskAttachment>(`/api/tasks/${enc(id)}/attachments`, att, "POST", "Could not attach the file"),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TASKS_KEY, id, "attachments"] }),
  });
}
