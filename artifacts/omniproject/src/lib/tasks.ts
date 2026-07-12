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
  context?: string | null;
  waitingOn?: string | null;
  assignee?: string | null;
  description?: string | null;
  priority?: string | null;
  tags?: string[];
  startDate?: string | null;
  dueDate?: string | null;
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

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) => sendJson<Task>(`/api/tasks/${encodeURIComponent(id)}`, patch, "PATCH", "Could not update the next action"),
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}
